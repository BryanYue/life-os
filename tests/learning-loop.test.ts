import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Store } from "../src/store.js";
import { app } from "../src/server.js";
import { withLanguageCodes } from "../src/modules.js";
import {
  upgradeLearningLoop,
  learningLoopUpgradeStatus,
} from "../src/builtin-upgrades.js";
import {
  configureLearning,
  recordLearningSession,
  recordAssessment,
  recordLearningAttempts,
  proposeLearningMethod,
  actOnLearningMethod,
  importTeacherSummary,
  reviseTeacherSummary,
  learningLoopReport,
  type AssessmentInput,
  type ItemInput,
} from "../src/learning-loop.js";
import {
  stable,
  type TeacherContract,
  type TeacherData,
  type AttemptData,
} from "../src/learning-loop-contract.js";
import { createReadingMaterial, recordReading } from "../src/reading.js";
import {
  HUMAN,
  type Entity,
  type Module,
  type EntityInput,
} from "../src/types.js";
import { hash } from "../src/vault.js";
import { exportBootstrap, importBootstrap } from "../src/sync.js";
import { obsidianNote } from "../src/obsidian.js";

const when = { occurredAt: "2030-04-01T09:00:00Z", timeZone: "UTC" };
const shared = (operationId: string, title = operationId) => ({
  ...when,
  operationId,
  title,
  language: "en",
  goalIds: [] as string[],
});
const scale = { id: "synthetic-points", min: 0, max: 990 };
const form = (id: string) => ({ source: "synthetic", id, version: "1" });
const item = (
  id: string,
  outcome: ItemInput["outcome"] = "incorrect",
): ItemInput => ({
  item: form(id),
  skill: "读",
  tag: "inference",
  answer: "synthetic answer",
  outcome,
  ...(outcome === "incorrect" ? { errorType: "错读限定词" } : {}),
  goalIds: [],
});
function fixture(upgrade = true) {
  const root = mkdtempSync(join(tmpdir(), "a-learning-loop-")),
    store = new Store(join(root, "data"));
  if (upgrade) upgradeLearningLoop(store);
  return {
    root,
    store,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
function goal(store: Store) {
  return store.save({
    expectedVersion: 0,
    entity: {
      ...when,
      module: "languages",
      type: "language-goal",
      title: "Synthetic original personal target",
      kind: "plan",
      status: "active",
      fields: {
        language: store.module("languages").schemaVersion < 3 ? "英语" : "en",
        measure: "Keep original personal goal text",
      },
      body: "Fictional",
      relations: [],
    },
  });
}
function session(
  store: Store,
  operationId: string,
  minutes = 20,
  occurredAt = when.occurredAt,
) {
  return recordLearningSession(store, {
    ...shared(operationId),
    occurredAt,
    skill: "读",
    minutes,
    context: "Synthetic independent practice",
  });
}
function assessmentInput(
  sessionId: string,
  operationId: string,
  phase: AssessmentInput["phase"],
  ids: string[],
  overrides: Partial<AssessmentInput> = {},
): AssessmentInput {
  return {
    ...shared(operationId),
    occurredAt: phase === "retest" ? "2030-04-08T09:00:00Z" : when.occurredAt,
    phase,
    category: "practice",
    sessionId,
    evaluation: { source: "synthetic", id: "reading-protocol", version: "1" },
    scale,
    form: form(operationId),
    difficulty: "synthetic B1",
    conditions: "15 minutes; no aids; quiet room",
    score: 600,
    scoreReference: "synthetic://reported-points",
    items: ids.map((id) => item(id)),
    ...overrides,
  };
}
function teacherContract(sessionId: string, revision = 1): TeacherContract {
  return {
    protocol: "life-os-teacher-summary-v1",
    source: { namespace: "fictional-teacher", id: "summary-1", revision },
    language: "en",
    ...when,
    originalText: `Fictional original revision ${revision}`,
    summary: `Fictional summary revision ${revision}`,
    modality: "chat-transcript",
    recommendations: ["Review the actual error examples"],
    sessionIds: [sessionId],
    goalIds: [],
  };
}
function update(store: Store, entity: Entity, patch: Partial<EntityInput>) {
  return store.save({
    expectedVersion: entity.version,
    expectedNoteHash: entity.noteHash,
    entity: { ...entity, ...patch },
  });
}
function assertZeroWrite(store: Store, work: () => unknown, pattern?: RegExp) {
  const before = store.backup();
  if (pattern) assert.throws(work, pattern);
  else assert.throws(work);
  assert.deepEqual(store.backup(), before);
}
function packet(store: Store, entity: Entity, fields: Entity["fields"]) {
  const base = store.snapshot(entity.id)!,
    value = { ...base, fields, version: base.version + 1 };
  const body = {
    protocol: 1 as const,
    batchId: "synthetic-loop-packet",
    device: "synthetic-loop-peer",
    from: 0,
    to: 1,
    complete: true as const,
    operations: [
      {
        id: "synthetic-loop-operation",
        device: "synthetic-loop-peer",
        sequence: 1,
        entityId: entity.id,
        base,
        value,
        at: when.occurredAt,
      },
    ],
  };
  return { ...body, sha256: hash(JSON.stringify(body)) };
}

test("explicit schema 2/3 to 4 keeps customized manifests, disabled state, fields and unknown Markdown", () => {
  for (const version of [2, 3]) {
    const f = fixture(false);
    try {
      const current = structuredClone(f.store.module("languages"));
      current.name = "User language list";
      current.entityTypes
        .find((t) => t.id === "language-goal")!
        .fields.push({ key: "userMemo", label: "User memo", type: "text" });
      f.store.db
        .prepare("UPDATE modules SET json=? WHERE id='languages'")
        .run(JSON.stringify(current));
      const old = goal(f.store),
        custom = update(f.store, old, {
          fields: { ...old.fields, userMemo: "preserve custom value" },
        });
      const path = f.store.vault.read(custom.id)!.path;
      writeFileSync(
        path,
        readFileSync(path, "utf8").replace(
          "life_module:",
          "user_unknown:\n  nested: [one, two]\nlife_module:",
        ),
      );
      f.store.captureExternalNotes();
      if (version === 3)
        f.store.migrateModule(withLanguageCodes(f.store.module("languages")));
      f.store.setEnabled("languages", false);
      const before = f.store.get(custom.id)!,
        result = upgradeLearningLoop(f.store),
        after = f.store.get(custom.id)!;
      assert.equal(result.backups.length, version === 2 ? 2 : 1);
      assert.equal(f.store.module("languages", false).enabled, false);
      assert.equal(
        f.store.module("languages", false).name,
        "User language list",
      );
      assert.equal(after.fields.userMemo, before.fields.userMemo);
      assert.equal(after.fields.measure, before.fields.measure);
      assert.equal(after.fields.language, before.fields.language);
      assert.match(readFileSync(path, "utf8"), /user_unknown/);
      assert.deepEqual(after.relations, before.relations);
      assert.equal(learningLoopUpgradeStatus(f.store).ready, true);
      const restored = Store.restore(
        join(f.root, "restored"),
        JSON.parse(readFileSync(result.backups[0], "utf8")),
      );
      assert.equal(restored.module("languages", false).schemaVersion, version);
      restored.close();
    } finally {
      f.close();
    }
  }
});
test("unupgraded custom names/fields retain CRUD and refuse collisions without partial upgrade", () => {
  for (const version of [2, 3, 4]) {
    const f = fixture(false);
    try {
      let module: Module = structuredClone(f.store.module("languages"));
      if (version === 3) module = withLanguageCodes(module);
      module.schemaVersion = version;
      module.entityTypes.push({
        id: "attempt",
        name: "User attempt",
        fields: [{ key: "memo", label: "User memo", type: "text" }],
      });
      module.entityTypes
        .find((t) => t.id === "practice")!
        .fields.push({
          key: "learningData",
          label: "Old user field",
          type: "text",
        });
      f.store.db
        .prepare("UPDATE modules SET json=? WHERE id='languages'")
        .run(JSON.stringify(module));
      const old = f.store.save({
        expectedVersion: 0,
        entity: {
          ...when,
          module: "languages",
          type: "attempt",
          title: "Custom old attempt",
          kind: "fact",
          status: "done",
          fields: { memo: "not loop JSON" },
          body: "legacy custom",
          relations: [],
        },
      });
      const changed = update(f.store, old, {
        fields: { memo: "still editable" },
      });
      assert.equal(changed.fields.memo, "still editable");
      assert.equal(learningLoopUpgradeStatus(f.store).ready, false);
      assertZeroWrite(f.store, () => upgradeLearningLoop(f.store));
    } finally {
      f.close();
    }
  }
});
test("schema 2 upgrade failure reports completed schema 3 stage and can be explicitly retried", () => {
  const f = fixture(false);
  try {
    const old = goal(f.store),
      migrate = f.store.migrateModule.bind(f.store);
    let calls = 0;
    f.store.migrateModule = (...args) => {
      if (++calls === 2) throw Error("Synthetic second-stage failure");
      return migrate(...args);
    };
    assert.throws(
      () => upgradeLearningLoop(f.store),
      /stopped at schema 3.*retry/i,
    );
    assert.equal(f.store.module("languages").schemaVersion, 3);
    assert.equal(f.store.get(old.id)!.fields.measure, old.fields.measure);
    assert.equal(learningLoopUpgradeStatus(f.store).ready, false);
    f.store.migrateModule = migrate;
    const retry = upgradeLearningLoop(f.store);
    assert.equal(retry.backups.length, 1);
    assert.equal(f.store.module("languages").schemaVersion, 4);
    assert.equal(f.store.get(old.id)!.fields.language, old.fields.language);
  } finally {
    f.close();
  }
});
test("fictional baseline, practices, new-item retest, explicit adjustment and teacher revisions form a descriptive loop", () => {
  const f = fixture();
  try {
    const originalGoal = goal(f.store),
      c1 = configureLearning(f.store, {
        ...shared("config-650"),
        goalId: originalGoal.id,
        scale,
        targetScore: 650,
        reason: "Fictional initial target",
        candidate: {
          minutesMin: 20,
          minutesMax: 30,
          retestWeeksMin: 1,
          retestWeeksMax: 4,
        },
      });
    configureLearning(f.store, {
      ...shared("config-700"),
      goalId: originalGoal.id,
      previousId: c1.id,
      scale,
      targetScore: 700,
      reason: "User changed target",
    });
    assert.equal(
      f.store.get(originalGoal.id)!.fields.measure,
      originalGoal.fields.measure,
    );
    const s1 = session(f.store, "baseline-session", 20),
      baseline = recordAssessment(
        f.store,
        assessmentInput(s1.id, "baseline", "baseline", ["b1", "b2"]),
      );
    const s2 = session(f.store, "practice-session", 25);
    recordLearningAttempts(f.store, {
      ...shared("practice-items"),
      occurredAt: "2030-04-02T09:00:00Z",
      sessionId: s2.id,
      form: form("practice"),
      items: [item("b1"), item("p1", "correct")],
    });
    const s3 = session(f.store, "retest-session", 30, "2030-04-08T09:00:00Z");
    const retest = recordAssessment(
      f.store,
      assessmentInput(s3.id, "retest", "retest", ["r1", "r2"], { score: 620 }),
    );
    const report = learningLoopReport(f.store);
    assert.equal(report.uniqueTotalMinutes, 75);
    assert.deepEqual(
      report.configurations.map((row) => row.data.targetScore).sort(),
      [650, 700],
    );
    assert.equal(report.configurations.filter((row) => row.current).length, 1);
    const comparison = report.comparisons.find(
      (row) =>
        row.baselineId === baseline.assessment.id &&
        row.retestId === retest.assessment.id,
    )!;
    assert.equal(comparison.comparable, true);
    assert.equal(comparison.scoreDelta, 20);
    assert.equal(comparison.sampleStatus, "insufficient");
    assert.match(comparison.conclusion, /不推断|不能证明/);
    assert.equal(report.weaknesses[0].samples, 5);
    assert.equal(report.weaknesses[0].repeated, 1);
    assert.equal(report.weaknesses[0].evidenceIds.length, 6);
    const proposal = proposeLearningMethod(f.store, {
      ...shared("method-proposal"),
      method: "Read qualifiers before answering",
      reason: "Actual synthetic wrong-answer examples",
      evidenceIds: baseline.attempts.map((e) => e.id),
    });
    assert.equal(proposal.kind, "inference");
    const adopted = actOnLearningMethod(f.store, {
      ...when,
      operationId: "method-adopt",
      entityId: proposal.id,
      expectedVersion: proposal.version,
      expectedNoteHash: proposal.noteHash,
      action: "adopt",
    });
    assert.equal(adopted.kind, "plan");
    assert.equal(f.store.get(proposal.id)!.status, "draft");
    const withdrawn = actOnLearningMethod(f.store, {
      ...when,
      operationId: "method-withdraw",
      entityId: adopted.id,
      expectedVersion: adopted.version,
      expectedNoteHash: adopted.noteHash,
      action: "withdraw",
    });
    assert.equal(withdrawn.status, "failed");
    const t1 = importTeacherSummary(f.store, {
      contract: teacherContract(s2.id),
    });
    const edited = reviseTeacherSummary(f.store, {
      operationId: "teacher-edit",
      entityId: t1.id,
      expectedVersion: t1.version,
      expectedNoteHash: t1.noteHash,
      summary: "Later human clarification",
    });
    assert.equal(
      importTeacherSummary(f.store, { contract: teacherContract(s2.id) })
        .version,
      edited.version,
    );
    assertZeroWrite(
      f.store,
      () =>
        importTeacherSummary(f.store, { contract: teacherContract(s2.id, 2) }),
      /conflict/i,
    );
    const t2 = importTeacherSummary(f.store, {
      contract: teacherContract(s2.id, 2),
      expectedVersion: edited.version,
      expectedNoteHash: edited.noteHash,
    });
    assert.equal(t2.id, t1.id);
    assert.equal(t2.body, "Fictional original revision 2");
    const oldReplay = importTeacherSummary(f.store, {
      contract: teacherContract(s2.id),
    });
    assert.equal(oldReplay.body, t2.body);
    const history = learningLoopReport(f.store).teacherSummaries[0].revisions;
    assert(history.some((row) => row.summary === "Later human clarification"));
    assert(
      history.some(
        (row) => row.originalText === "Fictional original revision 1",
      ),
    );
  } finally {
    f.close();
  }
});
test("reading and practice duration union survives corrections, deletion, replay and explicit restore", () => {
  const f = fixture();
  try {
    const material = createReadingMaterial(f.store, {
      ...shared("reading-material"),
      language: "en",
      reference: "synthetic://reading",
      sourceType: "技术文档",
      rights: "虚构样例",
      body: "Synthetic reading source",
    });
    const reading = recordReading(f.store, {
      ...when,
      operationId: "reading-session",
      materialId: material.id,
      minutes: 30,
      goalIds: [],
    });
    const payload = {
        ...shared("linked-session"),
        skill: "读" as const,
        readingSessionId: reading.id,
        context: "Same reading, language practice",
      },
      linked = recordLearningSession(f.store, payload);
    recordLearningSession(f.store, { ...payload, operationId: "second-link" });
    assert.equal(learningLoopReport(f.store).uniqueTotalMinutes, 30);
    assert.equal(linked.fields.minutes, undefined);
    assertZeroWrite(f.store, () =>
      recordLearningSession(f.store, {
        ...payload,
        operationId: "double-duration",
        minutes: 30,
      }),
    );
    const removedReading = update(f.store, reading, { deleted: true });
    assert.equal(learningLoopReport(f.store).uniqueTotalMinutes, 0);
    const removedLink = update(f.store, linked, { deleted: true });
    assert.equal(recordLearningSession(f.store, payload).deleted, true);
    assert.equal(
      recordLearningSession(f.store, payload).version,
      removedLink.version,
    );
    update(f.store, removedLink, { deleted: false });
    assert.equal(learningLoopReport(f.store).uniqueTotalMinutes, 0);
    update(f.store, removedReading, { deleted: false });
    assert.equal(learningLoopReport(f.store).uniqueTotalMinutes, 30);
    const standalone = session(f.store, "correctable-session", 10);
    const corrected = recordLearningSession(f.store, {
      ...shared("duration-correction"),
      entityId: standalone.id,
      expectedVersion: standalone.version,
      expectedNoteHash: standalone.noteHash,
      skill: "读",
      minutes: 15,
      context: "Correct duration",
    });
    assert.equal(learningLoopReport(f.store).uniqueTotalMinutes, 45);
    assert.equal(
      recordLearningSession(f.store, {
        ...shared("correctable-session"),
        skill: "读",
        minutes: 10,
        context: "Synthetic independent practice",
      }).version,
      corrected.version,
    );
    assertZeroWrite(
      f.store,
      () =>
        recordLearningSession(f.store, {
          ...shared("correctable-session"),
          skill: "读",
          minutes: 11,
          context: "Synthetic independent practice",
        }),
      /conflict/i,
    );
  } finally {
    f.close();
  }
});
test("deleted and revised item identities remain exposed; generic and sync writes cannot change identity or target configuration", () => {
  const f = fixture();
  try {
    const s = session(f.store, "exposure-session"),
      first = recordLearningAttempts(f.store, {
        ...shared("first-item"),
        sessionId: s.id,
        form: form("f1"),
        items: [item("seen-item")],
      })[0];
    update(f.store, first, { deleted: true });
    const revised = item("seen-item");
    revised.item.version = "2";
    const repeated = recordLearningAttempts(f.store, {
      ...shared("repeated-item"),
      sessionId: s.id,
      form: form("f2"),
      items: [revised],
    })[0];
    assert.equal(
      learningLoopReport(f.store).attempts.find(
        (row) => row.entity.id === repeated.id,
      )!.exposure,
      "repeat",
    );
    const data = JSON.parse(String(repeated.fields.data)) as AttemptData;
    const changedFields = {
      ...repeated.fields,
      data: stable({ ...data, item: form("fake-new-item") }),
    };
    assertZeroWrite(
      f.store,
      () => update(f.store, repeated, { fields: changedFields }),
      /immutable/,
    );
    assertZeroWrite(
      f.store,
      () =>
        f.store.importPacket(packet(f.store, repeated, changedFields), [
          "languages",
        ]),
      /immutable/,
    );
    const g = goal(f.store),
      config = configureLearning(f.store, {
        ...shared("immutable-target"),
        goalId: g.id,
        scale,
        targetScore: 650,
        reason: "Original",
      });
    const configFields = {
      ...config.fields,
      data: stable({
        ...JSON.parse(String(config.fields.data)),
        targetScore: 700,
      }),
    };
    assertZeroWrite(
      f.store,
      () => update(f.store, config, { fields: configFields }),
      /immutable/,
    );
    assertZeroWrite(
      f.store,
      () =>
        f.store.importPacket(packet(f.store, config, configFields), [
          "languages",
        ]),
      /immutable/,
    );
  } finally {
    f.close();
  }
});
test("repeated attempts never remove independent sample warning; skill/label/conditions/source mismatches explain non-comparability", () => {
  const f = fixture();
  try {
    const s = session(f.store, "repeat-source");
    for (let i = 0; i < 5; i++)
      recordLearningAttempts(f.store, {
        ...shared("repeated-" + i),
        occurredAt: `2030-04-0${i + 1}T09:00:00Z`,
        sessionId: s.id,
        form: form("repeat-form"),
        items: [item("single-item")],
      });
    let report = learningLoopReport(f.store);
    assert.equal(report.weaknesses[0].samples, 1);
    assert.equal(report.weaknesses[0].repeated, 4);
    assert.equal(report.weaknesses[0].sampleStatus, "insufficient");
    recordAssessment(
      f.store,
      assessmentInput(s.id, "repeat-baseline", "baseline", ["single-item"]),
    );
    recordAssessment(
      f.store,
      assessmentInput(s.id, "different-conditions", "retest", ["new-other"], {
        conditions: "With teacher help",
        difficulty: "synthetic B2",
        evaluation: { source: "other", id: "reading-protocol", version: "1" },
        items: [{ ...item("new-other"), skill: "听", tag: "listening" }],
      }),
    );
    report = learningLoopReport(f.store);
    assert.equal(report.comparisons[0].comparable, false);
    assert(
      report.comparisons[0].reasons.some((reason) =>
        reason.includes("基线包含"),
      ),
    );
    for (const name of ["协议", "难度", "条件", "技能"])
      assert(
        report.comparisons[0].reasons.some((reason) => reason.includes(name)),
      );
  } finally {
    f.close();
  }
});
test("stable practice source revisions are idempotent, preserve later correction and cannot revive tombstones", () => {
  const f = fixture();
  try {
    const imported: EntityInput = {
      ...when,
      module: "languages",
      type: "practice",
      title: "Imported synthetic practice",
      kind: "fact",
      status: "done",
      fields: {
        language: "en",
        skill: "读",
        minutes: 14,
        context: "Synthetic source practice",
        learningData: stable({ protocol: 1 }),
      },
      body: "Synthetic",
      relations: [],
      source: {
        namespace: "synthetic-practice",
        recordId: "session-one",
        revision: "1",
        mode: "import",
      },
    };
    const first = f.store.importSource(imported),
      corrected = recordLearningSession(f.store, {
        ...shared("source-correction"),
        entityId: first.id,
        expectedVersion: first.version,
        expectedNoteHash: first.noteHash,
        skill: "读",
        minutes: 16,
        context: "Manual correction",
      });
    assert.equal(f.store.importSource(imported).version, corrected.version);
    assert.equal(learningLoopReport(f.store).uniqueTotalMinutes, 16);
    const deleted = update(f.store, corrected, { deleted: true });
    assert.equal(f.store.importSource(imported).deleted, true);
    assertZeroWrite(
      f.store,
      () =>
        f.store.importSource({
          ...imported,
          source: { ...imported.source!, revision: "2" },
          deleted: false,
        }),
      /deleted/,
    );
    assert.equal(f.store.get(deleted.id)!.deleted, true);
  } finally {
    f.close();
  }
});
test("new links respect disabled source modules while historical links remain correctable and undoable", () => {
  const f = fixture();
  try {
    const material = createReadingMaterial(f.store, {
        ...shared("disabled-reading-material"),
        language: "en",
        reference: "synthetic://disabled-reading",
        sourceType: "技术文档",
        rights: "虚构样例",
        body: "Synthetic only",
      }),
      reading = recordReading(f.store, {
        ...when,
        operationId: "disabled-reading-owner",
        materialId: material.id,
        minutes: 18,
        goalIds: [],
      });
    const linked = recordLearningSession(f.store, {
      ...shared("existing-read-link"),
      skill: "读",
      readingSessionId: reading.id,
      context: "Previously authorized",
    });
    const related = update(f.store, session(f.store, "related-only-reading"), {
      relations: [{ type: "related", target: reading.id }],
    });
    f.store.setEnabled("learning", false);
    assertZeroWrite(
      f.store,
      () =>
        recordLearningSession(f.store, {
          ...shared("new-disabled-link"),
          skill: "读",
          readingSessionId: reading.id,
          context: "Cannot create a new disabled-source link",
        }),
      /disabled/,
    );
    const genericLink = { ...linked, id: "generic-disabled-reading-link" };
    const relatedFields = { ...related.fields };
    delete relatedFields.minutes;
    assertZeroWrite(
      f.store,
      () =>
        update(f.store, related, {
          fields: {
            ...relatedFields,
            learningData: linked.fields.learningData,
          },
          relations: [{ type: "evidence", target: reading.id }],
        }),
      /disabled/,
    );
    assertZeroWrite(
      f.store,
      () => f.store.save({ expectedVersion: 0, entity: genericLink }),
      /disabled/,
    );
    assertZeroWrite(
      f.store,
      () =>
        f.store.importSource({
          ...genericLink,
          source: {
            mode: "import",
            namespace: "synthetic-disabled-reading",
            recordId: "link",
            revision: "1",
          },
        }),
      /disabled/,
    );
    const base = f.store.snapshot(linked.id)!,
      value = {
        ...base,
        id: "sync-disabled-reading-link",
        version: 1,
        markdown: f.store.vault.compose(
          "sync-disabled-reading-link",
          "languages",
          base.body,
        ),
      },
      payload = {
        protocol: 1 as const,
        batchId: "disabled-link-batch",
        device: "disabled-link-peer",
        from: 0,
        to: 1,
        complete: true as const,
        operations: [
          {
            id: "disabled-link-operation",
            device: "disabled-link-peer",
            sequence: 1,
            entityId: value.id,
            base: null,
            value,
            at: when.occurredAt,
          },
        ],
      };
    assertZeroWrite(
      f.store,
      () =>
        f.store.importPacket(
          { ...payload, sha256: hash(JSON.stringify(payload)) },
          ["languages", "learning"],
        ),
      /disabled/,
    );
    const corrected = recordLearningSession(f.store, {
      ...shared("retained-link-correction"),
      entityId: linked.id,
      expectedVersion: linked.version,
      expectedNoteHash: linked.noteHash,
      skill: "读",
      readingSessionId: reading.id,
      context: "Correct existing context only",
    });
    const removed = update(f.store, corrected, { deleted: true });
    update(f.store, removed, { deleted: false });
    assert.equal(f.store.get(linked.id)!.deleted, false);
  } finally {
    f.close();
  }
});
test("configuration chains reject generic/source/sync forks, preserve tombstones and keep separate language heads through bootstrap/restore", () => {
  const f = fixture(),
    peer = new Store(join(f.root, "config-peer"));
  try {
    const target = f.store.save({
      expectedVersion: 0,
      entity: {
        ...when,
        module: "planning",
        type: "goal",
        title: "Synthetic shared language goal",
        kind: "plan",
        status: "active",
        fields: {},
        relations: [],
        body: "Fictional",
      },
    });
    const first = configureLearning(f.store, {
      ...shared("config-chain-one"),
      goalId: target.id,
      scale,
      targetScore: 650,
      reason: "Synthetic root",
    });
    const data = JSON.parse(String(first.fields.data));
    const fork = {
      ...first,
      id: "generic-config-fork",
      fields: { ...first.fields, data: stable({ ...data, targetScore: 700 }) },
    };
    assertZeroWrite(
      f.store,
      () => f.store.save({ expectedVersion: 0, entity: fork }),
      /Config history/,
    );
    assertZeroWrite(
      f.store,
      () =>
        f.store.importSource({
          ...fork,
          source: {
            mode: "import",
            namespace: "synthetic-config-fork",
            recordId: "fork",
            revision: "1",
          },
        }),
      /Config history/,
    );
    const packetBase = f.store.snapshot(first.id)!,
      value = {
        ...packetBase,
        ...fork,
        markdown: f.store.vault.compose(fork.id, "languages", fork.body),
      };
    const payload = {
      protocol: 1 as const,
      batchId: "config-fork-batch",
      device: "config-fork-peer",
      from: 0,
      to: 1,
      complete: true as const,
      operations: [
        {
          id: "config-fork-operation",
          device: "config-fork-peer",
          sequence: 1,
          entityId: value.id,
          base: null,
          value,
          at: when.occurredAt,
        },
      ],
    };
    assertZeroWrite(
      f.store,
      () =>
        f.store.importPacket(
          { ...payload, sha256: hash(JSON.stringify(payload)) },
          ["languages", "planning"],
        ),
      /Config history/,
    );
    const second = configureLearning(f.store, {
      ...shared("config-chain-two"),
      goalId: target.id,
      previousId: first.id,
      scale,
      targetScore: 700,
      reason: "Synthetic successor",
    });
    for (const bad of [
      { revision: 999, previousId: first.id },
      { revision: 2, previousId: first.id },
      { revision: 3, previousId: second.id, goalId: goal(f.store).id },
    ])
      assertZeroWrite(
        f.store,
        () =>
          f.store.save({
            expectedVersion: 0,
            entity: {
              ...first,
              id: "bad-config-chain",
              fields: { ...first.fields, data: stable({ ...data, ...bad }) },
              relations: [
                {
                  type: "supports",
                  target: bad.goalId ?? target.id,
                },
              ],
            },
          }),
        /Config history/,
      );
    update(f.store, second, { deleted: true });
    assertZeroWrite(
      f.store,
      () =>
        f.store.save({
          expectedVersion: 0,
          entity: {
            ...first,
            id: "deleted-config-fork",
            fields: {
              ...first.fields,
              data: stable({ ...data, revision: 2, previousId: first.id }),
            },
          },
        }),
      /Config history/,
    );
    const third = configureLearning(f.store, {
      ...shared("config-chain-three"),
      goalId: target.id,
      previousId: second.id,
      scale,
      targetScore: 710,
      reason: "Deleted predecessor retained",
    });
    const japanese = configureLearning(f.store, {
      ...shared("config-japanese"),
      language: "ja",
      goalId: target.id,
      scale,
      targetScore: 500,
      reason: "Separate Japanese chain",
    });
    assertZeroWrite(
      f.store,
      () =>
        f.store.save({
          expectedVersion: 0,
          entity: {
            ...japanese,
            id: "cross-language-config",
            fields: {
              ...japanese.fields,
              data: stable({
                ...JSON.parse(String(japanese.fields.data)),
                previousId: third.id,
                revision: 4,
              }),
            },
          },
        }),
      /Config history/,
    );
    assertZeroWrite(
      f.store,
      () =>
        update(f.store, first, { fields: { ...first.fields, language: "ja" } }),
      /immutable/,
    );
    assert.deepEqual(
      learningLoopReport(f.store)
        .configurations.filter((row) => row.current)
        .map((row) => row.entity.id)
        .sort(),
      [third.id, japanese.id].sort(),
    );
    const baseline = exportBootstrap(f.store, ["languages", "planning"]);
    assert.equal(
      importBootstrap(peer, baseline, ["languages", "planning"], {
        acceptManifests: true,
      }).applied,
      baseline.records.length,
    );
    assert.equal(
      learningLoopReport(peer).configurations.filter((row) => row.current)
        .length,
      2,
    );
    const corruptBackup = JSON.parse(peer.backup().payload);
    const corruptConfig = corruptBackup.tables.entities.find(
      (row: { id: string }) => row.id === third.id,
    );
    const corruptEntity = JSON.parse(corruptConfig.json);
    corruptEntity.fields.data = stable({
      ...JSON.parse(String(corruptEntity.fields.data)),
      revision: 999,
    });
    corruptConfig.json = JSON.stringify(corruptEntity);
    const corruptPayload = JSON.stringify(corruptBackup);
    assert.throws(
      () =>
        Store.restore(join(f.root, "config-invalid-restore"), {
          payload: corruptPayload,
          sha256: hash(corruptPayload),
        }),
      /Config history/,
    );
    const restored = Store.restore(
      join(f.root, "config-restored"),
      peer.backup(),
    );
    try {
      assert.equal(restored.get(second.id)!.deleted, true);
      assert.equal(
        learningLoopReport(restored).configurations.filter((row) => row.current)
          .length,
        2,
      );
      update(restored, restored.get(second.id)!, { deleted: false });
      assert.equal(
        learningLoopReport(restored).configurations.filter((row) => row.current)
          .length,
        2,
      );
    } finally {
      restored.close();
    }
    const concurrent = new Store(join(f.root, "concurrent-config-peer"));
    try {
      importBootstrap(
        concurrent,
        exportBootstrap(f.store, ["languages", "planning"]),
        ["languages", "planning"],
        { acceptManifests: true },
      );
      const left = configureLearning(f.store, {
        ...shared("left-successor"),
        goalId: target.id,
        previousId: third.id,
        scale,
        targetScore: 720,
        reason: "Concurrent local change",
      });
      configureLearning(concurrent, {
        ...shared("right-successor"),
        goalId: target.id,
        previousId: third.id,
        scale,
        targetScore: 730,
        reason: "Concurrent peer change",
      });
      assertZeroWrite(
        concurrent,
        () =>
          concurrent.importPacket(
            f.store.exportPacket(baseline.cursor, ["languages", "planning"]),
            ["languages", "planning"],
          ),
        /Config history/,
      );
      assert.equal(
        learningLoopReport(f.store).configurations.find(
          (row) => row.entity.id === left.id,
        )!.current,
        true,
      );
    } finally {
      concurrent.close();
    }
  } finally {
    peer.close();
    f.close();
  }
});
test("teacher source revisions and human summaries sync legally while forged revision changes remain zero-write across delta, bootstrap and restore", () => {
  const f = fixture(),
    peer = new Store(join(f.root, "teacher-peer")),
    baselinePeer = new Store(join(f.root, "teacher-baseline-peer"));
  upgradeLearningLoop(peer);
  try {
    const s = session(f.store, "teacher-sync-session"),
      firstContract = teacherContract(s.id),
      first = importTeacherSummary(f.store, { contract: firstContract });
    let cursor = 0;
    const transfer = () => {
      const outgoing = f.store.exportPacket(cursor, ["languages"]);
      const result = peer.importPacket(outgoing, ["languages"]);
      cursor = outgoing.to;
      assert.equal(result.conflicts, 0);
      return result;
    };
    assert.ok(transfer().applied > 0);
    const edited = reviseTeacherSummary(f.store, {
      operationId: "teacher-sync-human",
      entityId: first.id,
      expectedVersion: first.version,
      expectedNoteHash: first.noteHash,
      summary: "Human draft after source revision one",
    });
    assert.equal(transfer().applied, 1);
    assert.equal(
      (JSON.parse(String(peer.get(first.id)!.fields.data)) as TeacherData)
        .summary,
      "Human draft after source revision one",
    );
    const secondContract = teacherContract(s.id, 2),
      second = importTeacherSummary(f.store, {
        contract: secondContract,
        expectedVersion: edited.version,
        expectedNoteHash: edited.noteHash,
      });
    assert.equal(transfer().applied, 1);
    assert.equal(peer.get(first.id)!.body, secondContract.originalText);
    assert.equal(
      importTeacherSummary(peer, { contract: firstContract }).body,
      secondContract.originalText,
    );
    const forge = (
      contract: TeacherContract,
      operationId: string,
      create = false,
    ) => {
      const base = peer.snapshot(second.id)!,
        value = {
          ...base,
          id: create ? "forged-new-teacher" : base.id,
          version: base.version + 1,
          fields: {
            ...base.fields,
            data: stable({ protocol: 1, contract, summary: "Forged draft" }),
          },
          source: {
            mode: "import" as const,
            namespace: "learning-teacher:" + contract.source.namespace,
            recordId: contract.source.id,
            revision: String(contract.source.revision),
          },
          body: contract.originalText,
          markdown: peer.vault.compose(
            create ? "forged-new-teacher" : base.id,
            "languages",
            contract.originalText,
            create ? undefined : base.markdown,
          ),
        };
      const payload = {
        protocol: 1 as const,
        batchId: operationId + "-batch",
        device: operationId + "-peer",
        from: 0,
        to: 1,
        complete: true as const,
        operations: [
          {
            id: operationId,
            device: operationId + "-peer",
            sequence: 1,
            entityId: value.id,
            base: create ? null : base,
            value,
            at: when.occurredAt,
          },
        ],
      };
      assertZeroWrite(
        peer,
        () =>
          peer.importPacket(
            { ...payload, sha256: hash(JSON.stringify(payload)) },
            ["languages"],
          ),
        /teacher/i,
      );
    };
    forge(
      { ...firstContract, originalText: "Forged old original" },
      "forged-teacher-rollback",
    );
    forge(firstContract, "teacher-exact-old-rollback");
    forge(teacherContract(s.id, 3), "forged-teacher-new-revision");
    forge(
      {
        ...firstContract,
        source: { ...firstContract.source, id: "new-forged-source" },
      },
      "forged-teacher-create",
      true,
    );
    const latest = reviseTeacherSummary(f.store, {
      operationId: "teacher-sync-human-two",
      entityId: second.id,
      expectedVersion: second.version,
      expectedNoteHash: second.noteHash,
      summary: "Human draft after source revision two",
    });
    assert.equal(transfer().applied, 1);
    const corruptBackup = JSON.parse(peer.backup().payload);
    corruptBackup.tables.source_receipts.find(
      (row: { revision: string }) => row.revision === "2",
    ).digest = "v2:" + "0".repeat(64);
    const corruptPayload = JSON.stringify(corruptBackup);
    assert.throws(
      () =>
        Store.restore(join(f.root, "teacher-invalid-restore"), {
          payload: corruptPayload,
          sha256: hash(corruptPayload),
        }),
      /Teacher source receipt digest/,
    );
    const baseline = exportBootstrap(f.store, ["languages"]);
    importBootstrap(baselinePeer, baseline, ["languages"], {
      acceptManifests: true,
    });
    assert.equal(
      (
        JSON.parse(
          String(baselinePeer.get(second.id)!.fields.data),
        ) as TeacherData
      ).summary,
      "Human draft after source revision two",
    );
    assert.equal(
      baselinePeer.importPacket(f.store.exportPacket(0, ["languages"]), [
        "languages",
      ]).applied,
      0,
    );
    assert.equal(
      importTeacherSummary(baselinePeer, { contract: firstContract }).version,
      latest.version,
    );
    const restored = Store.restore(
      join(f.root, "teacher-restored-peer"),
      peer.backup(),
    );
    const restoredBaseline = Store.restore(
      join(f.root, "teacher-restored-baseline"),
      baselinePeer.backup(),
    );
    try {
      for (const target of [restored, restoredBaseline]) {
        assert.equal(
          importTeacherSummary(target, { contract: firstContract }).body,
          secondContract.originalText,
        );
        assert.equal(
          (
            JSON.parse(
              String(target.get(second.id)!.fields.data),
            ) as TeacherData
          ).summary,
          "Human draft after source revision two",
        );
        assert.equal(
          target.db
            .prepare("SELECT count(*) AS n FROM source_receipts WHERE entity=?")
            .get(second.id)!.n,
          2,
        );
      }
    } finally {
      restored.close();
      restoredBaseline.close();
    }
  } finally {
    peer.close();
    baselinePeer.close();
    f.close();
  }
});
test("teacher source conflicts accept explicit incoming/local choices, survive unresolved restore, converge and reject forged resolutions", () => {
  for (const choice of ["incoming", "local"] as const) {
    const f = fixture(),
      right = new Store(join(f.root, "right"));
    upgradeLearningLoop(right);
    let recovered: Store | undefined;
    try {
      const s = session(f.store, "conflict-session-" + choice),
        one = teacherContract(s.id),
        first = importTeacherSummary(f.store, { contract: one });
      const initial = f.store.exportPacket(0, ["languages"]);
      right.importPacket(initial, ["languages"]);
      const local = right.get(first.id)!;
      reviseTeacherSummary(right, {
        operationId: "local-conflicting-summary-" + choice,
        entityId: local.id,
        expectedVersion: local.version,
        expectedNoteHash: local.noteHash,
        summary: "Retain the human local draft",
      });
      const two = teacherContract(s.id, 2);
      importTeacherSummary(f.store, {
        contract: two,
        expectedVersion: first.version,
        expectedNoteHash: first.noteHash,
      });
      const incoming = f.store.exportPacket(initial.to, ["languages"]);
      assert.equal(right.importPacket(incoming, ["languages"]).conflicts, 1);
      const conflict = right.conflicts()[0];
      assertZeroWrite(
        right,
        () =>
          right.resolveConflict(
            conflict.id,
            choice,
            conflict.local!.version - 1,
          ),
        /Version conflict/,
      );
      right.db
        .prepare("INSERT INTO source_receipts VALUES(?,?,?,?,?)")
        .run(
          "learning-teacher:" + two.source.namespace,
          two.source.id,
          "2",
          "v2:" + "0".repeat(64),
          first.id,
        );
      assertZeroWrite(
        right,
        () =>
          right.resolveConflict(conflict.id, choice, conflict.local!.version),
        /Source revision/,
      );
      assert.equal(right.conflicts().length, 1);
      assert.equal(
        right.db
          .prepare("SELECT 1 FROM operations WHERE id=?")
          .get(conflict.id),
        undefined,
      );
      right.db
        .prepare(
          "DELETE FROM source_receipts WHERE namespace=? AND source_id=? AND revision='2'",
        )
        .run("learning-teacher:" + two.source.namespace, two.source.id);
      recovered = Store.restore(
        join(f.root, "unresolved-restored"),
        right.backup(),
      );
      assert.equal(recovered.conflicts().length, 1);
      const resolved = recovered.resolveConflict(
        conflict.id,
        choice,
        recovered.get(first.id)!.version,
      );
      const expectedContract = choice === "incoming" ? two : one;
      const expectedSummary =
        choice === "incoming" ? two.summary : "Retain the human local draft";
      assert.equal(resolved.body, expectedContract.originalText);
      assert.equal(
        (JSON.parse(String(resolved.fields.data)) as TeacherData).summary,
        expectedSummary,
      );
      assert.equal(recovered.conflicts().length, 0);
      assertZeroWrite(
        recovered,
        () => recovered!.resolveConflict(conflict.id, choice, resolved.version),
        /Unknown conflict/,
      );
      const decisionPacket = recovered.exportPacket(0, ["languages"]);
      assert.equal(
        f.store.importPacket(decisionPacket, ["languages"]).conflicts,
        1,
      );
      assert.equal(f.store.conflicts().length, 0);
      assert.equal(
        f.store.get(first.id)!.fields.data,
        recovered.get(first.id)!.fields.data,
      );
      assert.equal(f.store.get(first.id)!.body, recovered.get(first.id)!.body);
      for (const target of [f.store, recovered]) {
        assert.equal(
          target.db
            .prepare("SELECT revision FROM imports WHERE entity=?")
            .get(first.id)!.revision,
          String(expectedContract.source.revision),
        );
        assert.equal(
          importTeacherSummary(target, { contract: one }).body,
          expectedContract.originalText,
        );
        assert.equal(
          importTeacherSummary(target, { contract: two }).body,
          expectedContract.originalText,
        );
      }
      const replay = f.store.importPacket(decisionPacket, ["languages"]);
      assert.equal(replay.applied, 0);
      assert.equal(replay.conflicts, 0);
      assert.equal(f.store.get(first.id)!.fields.data, resolved.fields.data);
      const finalRestore = Store.restore(
        join(f.root, "resolved-restored"),
        recovered.backup(),
      );
      try {
        assert.equal(
          finalRestore.get(first.id)!.fields.data,
          resolved.fields.data,
        );
        assert.equal(finalRestore.conflicts().length, 0);
      } finally {
        finalRestore.close();
      }
      const resolution = decisionPacket.operations.find((op) =>
        op.resolves?.includes(conflict.id),
      )!;
      const forgedContract = { ...one, originalText: "Forged local original" };
      const forgedValue = {
        ...resolution.value,
        source: {
          mode: "import" as const,
          namespace: "learning-teacher:" + one.source.namespace,
          recordId: one.source.id,
          revision: "1",
        },
        fields: {
          ...resolution.value.fields,
          data: stable({
            protocol: 1,
            contract: forgedContract,
            summary: "Forged human draft",
          }),
        },
        body: forgedContract.originalText,
        markdown: f.store.vault.compose(
          first.id,
          "languages",
          forgedContract.originalText,
          resolution.value.markdown,
        ),
      };
      const forgedPayload = {
        protocol: 1 as const,
        batchId: "fake-resolution-batch-" + choice,
        device: "fake-resolution-peer-" + choice,
        from: 0,
        to: 1,
        complete: true as const,
        operations: [
          {
            ...resolution,
            id: "fake-resolution-operation-" + choice,
            device: "fake-resolution-peer-" + choice,
            sequence: 1,
            value: forgedValue,
          },
        ],
      };
      assertZeroWrite(
        f.store,
        () =>
          f.store.importPacket(
            { ...forgedPayload, sha256: hash(JSON.stringify(forgedPayload)) },
            ["languages"],
          ),
        /Teacher/,
      );
      const currentSnapshot = f.store.snapshot(first.id)!;
      const historicalSelection =
        choice === "incoming"
          ? initial.operations.find((op) => op.entityId === first.id)!.value
          : incoming.operations.find((op) => op.entityId === first.id)!.value;
      const noProofPayload = {
        ...forgedPayload,
        batchId: "unproven-resolution-" + choice,
        operations: [
          {
            ...forgedPayload.operations[0],
            id: "unproven-resolution-op-" + choice,
            base: currentSnapshot,
            value: {
              ...historicalSelection,
              version: currentSnapshot.version + 1,
              actor: "local-user",
            },
            resolves: ["unknown-source-proof", "unknown-selected-proof"],
          },
        ],
      };
      assertZeroWrite(
        f.store,
        () =>
          f.store.importPacket(
            { ...noProofPayload, sha256: hash(JSON.stringify(noProofPayload)) },
            ["languages"],
          ),
        /Teacher/,
      );
      const beforeNext = Number(
        recovered.db
          .prepare("SELECT seq FROM cursors WHERE device=?")
          .get(f.store.device)!.seq,
      );
      const current = f.store.get(first.id)!;
      const three = teacherContract(s.id, 3);
      importTeacherSummary(f.store, {
        contract: three,
        expectedVersion: current.version,
        expectedNoteHash: current.noteHash,
      });
      assert.equal(
        recovered.importPacket(
          f.store.exportPacket(beforeNext, ["languages"]),
          ["languages"],
        ).conflicts,
        0,
      );
      assert.equal(recovered.get(first.id)!.body, three.originalText);
      assert.equal(
        recovered.get(first.id)!.fields.data,
        f.store.get(first.id)!.fields.data,
      );
    } finally {
      recovered?.close();
      right.close();
      f.close();
    }
  }
});
test("invalid structured values, relations and unknown fields fail atomically at both specialized and generic writes", () => {
  const f = fixture();
  try {
    const s = session(f.store, "invalid-test-session"),
      request = assessmentInput(s.id, "atomic-assessment", "baseline", [
        "one",
        "two",
      ]);
    const wrong = structuredClone(request);
    (wrong.items[1] as unknown as Record<string, unknown>).outcome =
      "fabricated";
    assertZeroWrite(f.store, () => recordAssessment(f.store, wrong));
    for (const patch of [
      { score: 991 },
      { scale: { id: "x", min: 5, max: 5 } },
      { conditions: "" },
      { evaluation: { source: "x", id: "x", version: "" } },
      { unexpected: true },
    ])
      assertZeroWrite(f.store, () =>
        recordAssessment(f.store, { ...request, ...patch }),
      );
    const good = recordAssessment(f.store, request);
    const a = good.attempts[0];
    assertZeroWrite(
      f.store,
      () =>
        update(f.store, a, {
          occurredAt: "2030-04-01T09:00:00Z",
          timeZone: "Asia/Shanghai",
        }),
      /offset.*zone/i,
    );
    const invalidTimePacket = packet(f.store, a, a.fields);
    invalidTimePacket.operations[0].value.timeZone = "Asia/Shanghai";
    invalidTimePacket.sha256 = hash(
      JSON.stringify({ ...invalidTimePacket, sha256: undefined }),
    );
    assertZeroWrite(
      f.store,
      () => f.store.importPacket(invalidTimePacket, ["languages"]),
      /offset.*zone/i,
    );
    assertZeroWrite(
      f.store,
      () =>
        f.store.importSource({
          ...a,
          id: "invalid-time-source",
          timeZone: "Asia/Shanghai",
          source: {
            namespace: "synthetic-invalid-time",
            recordId: "bad-time",
            revision: "1",
            mode: "import",
          },
        }),
      /offset.*zone/i,
    );
    assertZeroWrite(
      f.store,
      () => update(f.store, a, { relations: [] }),
      /relation/,
    );
    assertZeroWrite(f.store, () =>
      update(f.store, good.assessment, {
        fields: {
          ...good.assessment.fields,
          data: stable({
            ...JSON.parse(String(good.assessment.fields.data)),
            scale: { id: "x", min: "0", max: 990 },
          }),
        },
      }),
    );
    assertZeroWrite(f.store, () =>
      recordLearningSession(f.store, {
        ...shared("invalid-zone"),
        occurredAt: "2030-04-01T09:00:00+08:00",
        timeZone: "UTC",
        skill: "读",
        minutes: 10,
        context: "Invalid zone",
      }),
    );
    const deleted = update(f.store, s, { deleted: true });
    assertZeroWrite(f.store, () =>
      recordAssessment(f.store, { ...request, operationId: "deleted-link" }),
    );
    update(f.store, a, { deleted: true });
    const restore = f.store.get(a.id)!;
    update(f.store, restore, { deleted: false });
    assert.equal(f.store.get(deleted.id)!.deleted, true);
  } finally {
    f.close();
  }
});
test("official scores remain separate and reject official item imports and unverified conversion data", () => {
  const f = fixture();
  try {
    const official = recordAssessment(f.store, {
      ...assessmentInput("", "official", "checkpoint", []),
      category: "official",
      sessionId: undefined,
      score: 650,
      scoreReference: "synthetic official report",
    });
    assert.equal(official.attempts.length, 0);
    assert.equal(learningLoopReport(f.store).uniqueTotalMinutes, 0);
    assertZeroWrite(f.store, () =>
      recordAssessment(f.store, {
        ...assessmentInput("", "official-items", "checkpoint", [
          "official-question",
        ]),
        category: "official",
        sessionId: undefined,
      }),
    );
    assertZeroWrite(f.store, () =>
      recordAssessment(f.store, {
        ...assessmentInput("", "conversion", "checkpoint", []),
        category: "official",
        sessionId: undefined,
        convertedScore: 650,
      } as AssessmentInput),
    );
  } finally {
    f.close();
  }
});
test("teacher revisions preserve custom fields/unknown frontmatter, reject changed source contracts and stale approvals, and never resurrect deletion", () => {
  const f = fixture();
  try {
    const module = structuredClone(f.store.module("languages"));
    module.entityTypes
      .find((t) => t.id === "teacher-summary")!
      .fields.push({ key: "userMemo", label: "User memo", type: "text" });
    f.store.db
      .prepare("UPDATE modules SET json=? WHERE id='languages'")
      .run(JSON.stringify(module));
    const s = session(f.store, "teacher-source-session"),
      c1 = teacherContract(s.id),
      t1 = importTeacherSummary(f.store, { contract: c1 });
    const manual = update(f.store, t1, {
      fields: { ...t1.fields, userMemo: "Personal field survives revisions" },
    });
    const path = f.store.vault.read(t1.id)!.path;
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        "life_module:",
        "custom_unknown: {nested: true}\nlife_module:",
      ),
    );
    f.store.captureExternalNotes();
    const current = f.store.get(t1.id)!;
    assertZeroWrite(
      f.store,
      () =>
        importTeacherSummary(f.store, {
          contract: teacherContract(s.id, 2),
          expectedVersion: manual.version,
          expectedNoteHash: manual.noteHash,
        }),
      /conflict/i,
    );
    const t2 = importTeacherSummary(f.store, {
      contract: teacherContract(s.id, 2),
      expectedVersion: current.version,
      expectedNoteHash: current.noteHash,
    });
    assert.equal(t2.fields.userMemo, "Personal field survives revisions");
    assert.match(readFileSync(path, "utf8"), /custom_unknown/);
    const replay = importTeacherSummary(f.store, { contract: c1 });
    assert.equal(replay.fields.userMemo, t2.fields.userMemo);
    assert.equal(replay.body, t2.body);
    assertZeroWrite(
      f.store,
      () =>
        importTeacherSummary(f.store, {
          contract: { ...c1, originalText: "Changed under old revision" },
        }),
      /revision/i,
    );
    assertZeroWrite(
      f.store,
      () =>
        importTeacherSummary(f.store, {
          contract: { ...c1, pronunciationScore: 95 },
        } as { contract: TeacherContract }),
      /unknown field/,
    );
    const fakeRevision = {
      ...JSON.parse(String(t2.fields.data)),
      contract: {
        ...teacherContract(s.id, 3),
        originalText: "Forged source revision",
      },
    };
    assertZeroWrite(
      f.store,
      () =>
        update(f.store, t2, {
          body: "Forged source revision",
          fields: { ...t2.fields, data: stable(fakeRevision) },
          source: {
            namespace: "learning-teacher:fictional-teacher",
            recordId: "summary-1",
            revision: "3",
            mode: "import",
          },
        }),
      /reviewed import/,
    );
    assertZeroWrite(
      f.store,
      () =>
        f.store.save({
          expectedVersion: 0,
          entity: {
            ...t2,
            id: "forged-new-teacher",
            body: "Forged source revision",
            fields: { ...t2.fields, data: stable(fakeRevision) },
            source: {
              namespace: "learning-teacher:fictional-teacher",
              recordId: "summary-1",
              revision: "3",
              mode: "import",
            },
          },
        }),
      /source import/,
    );
    const data = JSON.parse(String(t2.fields.data)) as TeacherData,
      wrong = {
        ...data,
        contract: { ...data.contract, originalText: "Overwrite original" },
      };
    assertZeroWrite(f.store, () =>
      f.store.importPacket(
        packet(f.store, t2, { ...t2.fields, data: stable(wrong) }),
        ["languages"],
      ),
    );
    const removed = update(f.store, t2, { deleted: true });
    assert.equal(importTeacherSummary(f.store, { contract: c1 }).deleted, true);
    assertZeroWrite(
      f.store,
      () =>
        importTeacherSummary(f.store, {
          contract: teacherContract(s.id, 3),
          expectedVersion: removed.version,
          expectedNoteHash: removed.noteHash,
        }),
      /deleted/,
    );
  } finally {
    f.close();
  }
});
test("unknown stored protocols produce per-record issues without rewriting or clearing valid report data", () => {
  const f = fixture();
  try {
    const s = session(f.store, "protocol-session"),
      a = recordAssessment(
        f.store,
        assessmentInput(s.id, "protocol-baseline", "baseline", [
          "protocol-item",
        ]),
      );
    const row = f.store.db
      .prepare("SELECT json FROM entities WHERE id=?")
      .get(a.assessment.id)!;
    const encoded = JSON.parse(String(row.json));
    encoded.fields.data = stable({
      protocol: 999,
      unknownFuture: { preserve: true },
    });
    f.store.db
      .prepare("UPDATE entities SET json=? WHERE id=?")
      .run(JSON.stringify(encoded), a.assessment.id);
    const before = f.store.backup();
    const report = learningLoopReport(f.store);
    assert.equal(report.sessions.length, 1);
    assert(
      report.issues.some(
        (issue) =>
          issue.entityId === a.assessment.id &&
          /Unsupported|unknown/.test(issue.message),
      ),
    );
    assert.deepEqual(f.store.backup(), before);
  } finally {
    f.close();
  }
});
test("late historical import and corrected timestamps preserve earliest exposure, while ties remain unproven", () => {
  const f = fixture();
  try {
    const s = session(f.store, "chronology-session");
    recordAssessment(
      f.store,
      assessmentInput(
        s.id,
        "chronology-baseline",
        "baseline",
        ["chrono-b1", "chrono-b2"],
        { occurredAt: "2030-01-01T09:00:00Z" },
      ),
    );
    const retest = recordAssessment(
      f.store,
      assessmentInput(
        s.id,
        "chronology-retest",
        "retest",
        ["chrono-r1", "chrono-r2"],
        { occurredAt: "2030-04-01T09:00:00Z" },
      ),
    );
    assert.equal(learningLoopReport(f.store).comparisons[0].comparable, true);
    const historical = recordLearningAttempts(f.store, {
      ...shared("late-historical"),
      occurredAt: "2030-02-01T09:00:00Z",
      sessionId: s.id,
      form: form("late-history"),
      items: [item("chrono-r1")],
    })[0];
    assert.equal(
      learningLoopReport(f.store).attempts.find(
        (row) => row.entity.id === retest.attempts[0].id,
      )!.exposure,
      "repeat",
    );
    assert.equal(learningLoopReport(f.store).comparisons[0].comparable, false);
    update(f.store, historical, {
      occurredAt: "2030-06-01T09:00:00Z",
      deleted: true,
    });
    assert.equal(
      learningLoopReport(f.store).attempts.find(
        (row) => row.entity.id === retest.attempts[0].id,
      )!.exposure,
      "repeat",
    );
    recordLearningAttempts(f.store, {
      ...shared("tied-exposure"),
      occurredAt: "2030-04-01T09:00:00Z",
      sessionId: s.id,
      form: form("tied-history"),
      items: [item("chrono-r2")],
    });
    assert(
      learningLoopReport(f.store).issues.some((issue) =>
        issue.message.includes("先后不明"),
      ),
    );
  } finally {
    f.close();
  }
});
test("loop history, source receipts, tombstones and idempotency survive close/reopen and actual backup restore", () => {
  const root = mkdtempSync(join(tmpdir(), "a-loop-lifecycle-")),
    dataRoot = join(root, "data");
  let store = new Store(dataRoot);
  try {
    upgradeLearningLoop(store);
    const g = goal(store),
      c1 = configureLearning(store, {
        ...shared("lifecycle-config1"),
        goalId: g.id,
        scale,
        targetScore: 650,
        reason: "Initial",
      });
    configureLearning(store, {
      ...shared("lifecycle-config2"),
      goalId: g.id,
      previousId: c1.id,
      scale,
      targetScore: 700,
      reason: "Changed",
    });
    const sessionPayload = {
        ...shared("lifecycle-session"),
        skill: "读" as const,
        minutes: 18,
        context: "Synthetic lifecycle",
      },
      s = recordLearningSession(store, sessionPayload);
    const originalAttempt = recordLearningAttempts(store, {
      ...shared("lifecycle-attempt1"),
      sessionId: s.id,
      form: form("lifecycle-form1"),
      items: [item("lifecycle-q")],
    })[0];
    update(store, originalAttempt, { deleted: true });
    recordLearningAttempts(store, {
      ...shared("lifecycle-attempt2"),
      occurredAt: "2030-04-02T09:00:00Z",
      sessionId: s.id,
      form: form("lifecycle-form2"),
      items: [item("lifecycle-q")],
    });
    const contract = teacherContract(s.id),
      t1 = importTeacherSummary(store, { contract }),
      edited = reviseTeacherSummary(store, {
        operationId: "lifecycle-edit",
        entityId: t1.id,
        expectedVersion: t1.version,
        expectedNoteHash: t1.noteHash,
        summary: "Human lifecycle revision",
      });
    importTeacherSummary(store, {
      contract: teacherContract(s.id, 2),
      expectedVersion: edited.version,
      expectedNoteHash: edited.noteHash,
    });
    const before = learningLoopReport(store),
      backup = store.backup();
    store.close();
    store = new Store(dataRoot);
    assert.deepEqual(learningLoopReport(store), before);
    assert.equal(recordLearningSession(store, sessionPayload).id, s.id);
    assert.equal(store.get(originalAttempt.id)!.deleted, true);
    const restored = Store.restore(join(root, "restored"), backup);
    try {
      assert.deepEqual(learningLoopReport(restored), before);
      assert.equal(
        recordLearningSession(restored, sessionPayload).version,
        s.version,
      );
      assert.equal(
        importTeacherSummary(restored, { contract }).body,
        "Fictional original revision 2",
      );
      assert.equal(learningLoopReport(restored).attempts[0].exposure, "repeat");
      assert.equal(restored.get(originalAttempt.id)!.deleted, true);
    } finally {
      restored.close();
    }
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("real loopback HTTP enforces human session/CSRF/agent denial, atomic validation and module activation", async () => {
  const f = fixture(false),
    server = app(f.store, {
      port: 4387,
      agentToken: "synthetic-loop-agent",
      agentModules: ["languages"],
    });
  try {
    await server.listen({ host: "127.0.0.1", port: 4387 });
    const base = "http://127.0.0.1:4387";
    assert.equal(
      (
        await fetch(base + "/api/learning-loop/upgrade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      401,
    );
    const auth = await fetch(base + "/api/session"),
      csrf = ((await auth.json()) as { csrf: string }).csrf,
      cookie = auth.headers.get("set-cookie")!.split(";")[0];
    const headers = {
      cookie,
      "x-csrf-token": csrf,
      "Content-Type": "application/json",
    };
    assert.equal(
      (
        await fetch(base + "/api/learning-loop/upgrade", {
          method: "POST",
          headers: { cookie, "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/api/learning-loop/upgrade", {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
      200,
    );
    const request = {
      ...shared("http-session"),
      skill: "说",
      minutes: 12,
      context: "Synthetic speaking text observation; no pronunciation score",
    };
    const response = await fetch(base + "/api/learning-loop/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify(request),
    });
    assert.equal(response.status, 200);
    const entity = (await response.json()) as Entity;
    assert.equal(
      (
        (await (
          await fetch(base + "/api/learning-loop/sessions", {
            method: "POST",
            headers,
            body: JSON.stringify(request),
          })
        ).json()) as Entity
      ).id,
      entity.id,
    );
    const before = f.store.backup();
    const invalid = await fetch(base + "/api/learning-loop/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...request,
        operationId: "http-invalid",
        minutes: -1,
      }),
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(f.store.backup(), before);
    assert.equal(
      (
        await fetch(base + "/api/learning-loop/report", {
          headers: { authorization: "Bearer synthetic-loop-agent" },
        })
      ).status,
      403,
    );
    f.store.setEnabled("languages", false);
    const disabledBefore = f.store.backup();
    assert.equal(
      (
        await fetch(base + "/api/learning-loop/sessions", {
          method: "POST",
          headers,
          body: JSON.stringify({ ...request, operationId: "disabled-session" }),
        })
      ).status,
      400,
    );
    assert.deepEqual(f.store.backup(), disabledBefore);
  } finally {
    await server.close();
    f.close();
  }
});
test("real CLI upgrades, records idempotently, imports teacher contract and rejects invalid JSON without writes", () => {
  const root = mkdtempSync(join(tmpdir(), "a-loop-cli-")),
    data = join(root, "data");
  try {
    const run = (...args: string[]) =>
      spawnSync(
        process.execPath,
        [
          resolve("node_modules/tsx/dist/cli.mjs"),
          "src/cli.ts",
          "learning-loop",
          ...args,
        ],
        {
          cwd: resolve("."),
          env: { ...process.env, LIFE_OS_HOME: data },
          encoding: "utf8",
        },
      );
    const upgraded = run("upgrade");
    assert.equal(upgraded.status, 0, upgraded.stderr);
    const payload = {
        ...shared("cli-session"),
        skill: "读",
        minutes: 22,
        context: "Synthetic CLI session",
      },
      file = join(root, "session.json");
    writeFileSync(file, JSON.stringify(payload));
    const first = run("session", file);
    assert.equal(first.status, 0, first.stderr);
    const entity = JSON.parse(first.stdout) as Entity;
    assert.equal(JSON.parse(run("session", file).stdout).id, entity.id);
    const contractFile = join(root, "teacher.json");
    writeFileSync(
      contractFile,
      JSON.stringify({ contract: teacherContract(entity.id) }),
    );
    const imported = run("teacher-import", contractFile);
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(
      JSON.parse(imported.stdout).body,
      "Fictional original revision 1",
    );
    assert.equal(JSON.parse(run("report").stdout).uniqueTotalMinutes, 22);
    let store = new Store(data);
    const before = store.backup();
    store.close();
    writeFileSync(
      file,
      JSON.stringify({ ...payload, operationId: "cli-invalid", minutes: "22" }),
    );
    const invalid = run("session", file);
    assert.notEqual(invalid.status, 0);
    store = new Store(data);
    assert.deepEqual(store.backup(), before);
    store.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("review regression: source conflict plus later teacher edit remains resolvable in one or split packets", () => {
  for (const split of [false, true])
    for (const choice of ["incoming", "local"] as const) {
      const f = fixture(),
        peer = new Store(join(f.root, "peer"));
      upgradeLearningLoop(peer);
      let restored: Store | undefined;
      try {
        const s = session(f.store, "batch-conflict-session"),
          first = importTeacherSummary(f.store, {
            contract: teacherContract(s.id),
          });
        const initial = f.store.exportPacket(0, ["languages"]);
        peer.importPacket(initial, ["languages"]);
        const old = peer.get(first.id)!;
        reviseTeacherSummary(peer, {
          operationId: "batch-local-draft",
          entityId: old.id,
          expectedVersion: old.version,
          expectedNoteHash: old.noteHash,
          summary: "Local draft",
        });
        const second = importTeacherSummary(f.store, {
          contract: teacherContract(s.id, 2),
          expectedVersion: first.version,
          expectedNoteHash: first.noteHash,
        });
        reviseTeacherSummary(f.store, {
          operationId: "batch-remote-edit",
          entityId: second.id,
          expectedVersion: second.version,
          expectedNoteHash: second.noteHash,
          summary: "Remote revision two draft",
        });
        const incoming = f.store.exportPacket(initial.to, ["languages"]);
        assert.equal(incoming.operations.length, 2);
        const subset = (
          from: number,
          operations: typeof incoming.operations,
        ) => {
          const body = {
            protocol: incoming.protocol,
            batchId: incoming.batchId,
            device: incoming.device,
            from,
            to: operations.at(-1)!.sequence,
            complete: incoming.complete,
            operations,
          };
          return { ...body, sha256: hash(JSON.stringify(body)) };
        };
        assertZeroWrite(
          peer,
          () =>
            peer.importPacket(subset(initial.to, [incoming.operations[1]]), [
              "languages",
            ]),
          /source receipt/,
        );
        const forged = structuredClone(incoming.operations);
        const data = JSON.parse(
          String(forged[1].value.fields.data),
        ) as TeacherData;
        data.contract.originalText = "Forged original";
        forged[1].value.fields.data = stable(data);
        assertZeroWrite(peer, () =>
          peer.importPacket(subset(initial.to, forged), ["languages"]),
        );
        if (split) {
          assert.equal(
            peer.importPacket(subset(initial.to, [incoming.operations[0]]), [
              "languages",
            ]).conflicts,
            1,
          );
          assert.equal(
            peer.importPacket(
              subset(incoming.operations[0].sequence, [incoming.operations[1]]),
              ["languages"],
            ).conflicts,
            1,
          );
        } else
          assert.equal(peer.importPacket(incoming, ["languages"]).conflicts, 2);
        assert.equal(peer.conflicts().length, 2);
        assert.equal(
          peer.db
            .prepare("SELECT count(*) AS n FROM source_receipts WHERE entity=?")
            .get(first.id)!.n,
          1,
        );
        assert.equal(
          peer.db
            .prepare("SELECT 1 FROM operations WHERE id=?")
            .get(incoming.operations[0].id),
          undefined,
        );
        const bootstrapped = new Store(join(f.root, "bootstrap-unresolved"));
        try {
          importBootstrap(
            bootstrapped,
            exportBootstrap(peer, ["languages"]),
            ["languages"],
            { acceptManifests: true },
          );
          assert.equal(
            bootstrapped.importPacket(f.store.exportPacket(0, ["languages"]), [
              "languages",
            ]).conflicts,
            2,
          );
          assert.equal(bootstrapped.conflicts().length, 2);
        } finally {
          bootstrapped.close();
        }

        assert.equal(
          (JSON.parse(String(peer.get(first.id)!.fields.data)) as TeacherData)
            .summary,
          "Local draft",
        );
        assert.equal(
          peer.db
            .prepare("SELECT revision FROM imports WHERE entity=?")
            .get(first.id)!.revision,
          "1",
        );
        restored = Store.restore(join(f.root, "unresolved"), peer.backup());
        assert.equal(restored.conflicts().length, 2);
        const later = restored
          .conflicts()
          .find((c) => c.id === incoming.operations[1].id)!;
        const resolved = restored.resolveConflict(
          later.id,
          choice,
          restored.get(first.id)!.version,
        );
        const expected =
          choice === "incoming" ? "Remote revision two draft" : "Local draft";
        assert.equal(
          (JSON.parse(String(resolved.fields.data)) as TeacherData).summary,
          expected,
        );
        for (const remaining of restored.conflicts())
          restored.resolveConflict(
            remaining.id,
            "local",
            restored.get(first.id)!.version,
          );
        const back = restored.exportPacket(0, ["languages"]);
        f.store.importPacket(back, ["languages"]);
        assert.equal(f.store.conflicts().length, 0);
        assert.equal(
          f.store.get(first.id)!.fields.data,
          restored.get(first.id)!.fields.data,
        );
        assert.equal(f.store.importPacket(back, ["languages"]).applied, 0);
        assert.equal(f.store.conflicts().length, 0);
        assert.equal(restored.importPacket(incoming, ["languages"]).applied, 0);
        assert.equal(restored.conflicts().length, 0);
        const final = Store.restore(
          join(f.root, "resolved"),
          restored.backup(),
        );
        try {
          assert.equal(
            (
              JSON.parse(
                String(final.get(first.id)!.fields.data),
              ) as TeacherData
            ).summary,
            expected,
          );
        } finally {
          final.close();
        }
      } finally {
        restored?.close();
        peer.close();
        f.close();
      }
    }
});

test("review regression: attempt corrections retain an inactive goal but new links are refused", () => {
  const f = fixture();
  try {
    const g = goal(f.store),
      s = session(f.store, "retained-attempt-session");
    const originalItem = { ...item("retained-goal-item"), goalIds: [g.id] };
    const first = recordLearningAttempts(f.store, {
      ...shared("retained-attempt"),
      sessionId: s.id,
      form: form("retained-form"),
      items: [originalItem],
    })[0];
    update(f.store, g, { status: "done" });
    const corrected = recordLearningAttempts(f.store, {
      ...shared("correct-retained-attempt"),
      sessionId: s.id,
      form: form("retained-form"),
      items: [
        {
          ...originalItem,
          entityId: first.id,
          expectedVersion: first.version,
          expectedNoteHash: first.noteHash,
          answer: "corrected synthetic answer",
        },
      ],
    })[0];
    assert.equal(
      (JSON.parse(String(corrected.fields.data)) as AttemptData).answer,
      "corrected synthetic answer",
    );
    assert.ok(
      corrected.relations.some(
        (r) => r.type === "supports" && r.target === g.id,
      ),
    );
    assertZeroWrite(
      f.store,
      () =>
        recordLearningAttempts(f.store, {
          ...shared("new-inactive-attempt"),
          sessionId: s.id,
          form: form("retained-form"),
          items: [{ ...item("new-goal-item"), goalIds: [g.id] }],
        }),
      /active goal/,
    );
  } finally {
    f.close();
  }
});

test("review regression: deleted legacy language sources retain baseline revision behavior", () => {
  for (const upgraded of [false, true]) {
    const f = fixture(upgraded);
    try {
      const template = goal(f.store);
      const input = {
        ...template,
        id: undefined,
        source: {
          mode: "import" as const,
          namespace: "synthetic-legacy",
          recordId: "goal-source",
          revision: "1",
        },
      };
      const first = f.store.importSource(input);
      update(f.store, first, { deleted: true });
      const next = f.store.importSource({
        ...input,
        title: "Updated source",
        source: { ...input.source, revision: "2" },
      });
      assert.equal(next.id, first.id);
      assert.equal(next.source.revision, "2");
      assert.equal(next.deleted, false);
    } finally {
      f.close();
    }
  }
});

test("review regression: teacher external body damage remains visible and recoverable without changing original history", () => {
  const f = fixture();
  try {
    const s = session(f.store, "damaged-teacher-session"),
      teacher = importTeacherSummary(f.store, {
        contract: teacherContract(s.id),
      });
    const note = f.store.vault.read(teacher.id)!,
      before = readFileSync(note.path, "utf8");
    writeFileSync(
      note.path,
      before.replace(teacher.body, "Synthetic external change"),
    );
    const report = learningLoopReport(f.store);
    assert.ok(
      report.issues.some(
        (issue) =>
          issue.entityId === teacher.id && /原文|original/i.test(issue.message),
      ),
    );
    assert.equal(
      report.teacherSummaries[0].data.contract.originalText,
      teacher.body,
    );
    for (const action of [
      () => f.store.conflicts(),
      () => f.store.exportPacket(0, ["languages"]),
      () => f.store.backup(),
    ])
      assert.throws(action, /original text/);
    assert.match(readFileSync(note.path, "utf8"), /Synthetic external change/);
    writeFileSync(note.path, before);
    assert.equal(f.store.conflicts().length, 0);
    assert.ok(f.store.backup());
  } finally {
    f.close();
  }
});

test("review regression: teacher generic writes preserve original, time, receipt identity and reviewed import", () => {
  const f = fixture();
  try {
    const s = session(f.store, "teacher-guard-session"),
      teacher = importTeacherSummary(f.store, {
        contract: teacherContract(s.id),
      });
    assert.equal(
      obsidianNote(f.store, teacher.id).protectedTeacherOriginal,
      true,
    );
    assert.equal(obsidianNote(f.store, s.id).protectedTeacherOriginal, false);
    for (const patch of [
      { body: "Forged original" },
      { occurredAt: "2030-04-02T09:00:00Z" },
      { timeZone: "Etc/UTC" },
      { source: { ...teacher.source, recordId: "forged-receipt" } },
    ])
      assertZeroWrite(
        f.store,
        () => update(f.store, teacher, patch),
        /Teacher|teacher/,
      );
    const contract = teacherContract(s.id, 2);
    const input = {
      ...teacher,
      source: { ...teacher.source, revision: "2" },
      body: contract.originalText,
      fields: {
        ...teacher.fields,
        data: stable({ protocol: 1, contract, summary: contract.summary }),
      },
    };
    assertZeroWrite(
      f.store,
      () => f.store.importSource(input),
      /review the current summary/,
    );
    assertZeroWrite(
      f.store,
      () =>
        f.store.importSource(input, HUMAN, {
          expectedVersion: teacher.version,
          expectedNoteHash: "stale",
        }),
      /review the current summary/,
    );
    const imported = f.store.importSource(input, HUMAN, {
      expectedVersion: teacher.version,
      expectedNoteHash: teacher.noteHash,
    });
    assert.equal(imported.body, contract.originalText);
    const backup = JSON.parse(f.store.backup().payload);
    backup.tables.source_receipts = [];
    const payload = JSON.stringify(backup);
    assert.throws(
      () =>
        Store.restore(join(f.root, "missing-receipts"), {
          payload,
          sha256: hash(payload),
        }),
      /receipt/i,
    );
  } finally {
    f.close();
  }
});

test("review regression: assessment category is immutable and service writes require a human", () => {
  const f = fixture();
  try {
    const s = session(f.store, "category-guard-session");
    const assessment = recordAssessment(
      f.store,
      assessmentInput(s.id, "category-baseline", "baseline", ["category-item"]),
    ).assessment;
    const data = JSON.parse(String(assessment.fields.data));
    data.category = "official";
    assertZeroWrite(
      f.store,
      () =>
        update(f.store, assessment, {
          fields: { ...assessment.fields, data: stable(data) },
        }),
      /category|Category|identity/i,
    );
    assertZeroWrite(
      f.store,
      () =>
        recordLearningSession(
          f.store,
          {
            ...shared("ai-session"),
            skill: "读",
            minutes: 10,
            context: "Synthetic",
          },
          { ...HUMAN, role: "ai" },
        ),
      /human|Human|Permission/,
    );
  } finally {
    f.close();
  }
});

test("review regression: unreadable exposure history prevents new-item comparability", () => {
  const f = fixture();
  try {
    const s = session(f.store, "history-gate-session");
    recordAssessment(
      f.store,
      assessmentInput(s.id, "history-base", "baseline", ["history-base-item"]),
    );
    recordAssessment(
      f.store,
      assessmentInput(s.id, "history-retest", "retest", ["history-new-item"]),
    );
    assert.equal(learningLoopReport(f.store).comparisons[0].comparable, true);
    f.store.db
      .prepare("INSERT INTO operations(id,json) VALUES(?,?)")
      .run("synthetic-unreadable-history", "{");
    const report = learningLoopReport(f.store);
    assert.equal(report.comparisons[0].comparable, false);
    assert.ok(report.comparisons[0].reasons.includes("历史题目证据不完整"));
    assert.ok(report.issues.some((issue) => issue.entityId === "history"));
  } finally {
    f.close();
  }
});
