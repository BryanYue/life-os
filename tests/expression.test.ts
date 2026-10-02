import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import {
  createExpression,
  reviseExpression,
  expressionFeedback,
  expressionReport,
} from "../src/expression.js";
import type {
  CreateExpressionInput,
  ExpressionStructure,
} from "../src/expression.js";
import type { Capability, EntityInput } from "../src/types.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "life-expression-test-"));
  const store = new Store(join(root, "data"));
  return {
    root,
    store,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
const original =
  "# 虚构社区图书角\n\n先写想法：我想让书架更容易找到书。\n也许可以按主题放，但借阅频率还没有调查。\n\n这份自由原稿超过三句话。\n暂时保留不确定之处。\n";
const createInput = (
  operationId: string,
  patch: Partial<CreateExpressionInput> = {},
): CreateExpressionInput => ({
  operationId,
  title: "虚构图书角表达练习",
  mode: "文字",
  originalText: original,
  occurredAt: "2030-04-01",
  timeZone: "Asia/Shanghai",
  ...patch,
});
const structure = (sourceId?: string): ExpressionStructure => ({
  claim: "可以先试做主题标签，再观察读者反馈。",
  groups: [
    {
      reason: "标签让分类更清楚",
      evidence: [
        {
          text: "虚构试摆中，三本园艺书被放在同一层。",
          ...(sourceId ? { sourceId } : {}),
        },
      ],
    },
    { reason: "试做范围应当有限", evidence: [] },
  ],
});
function record(
  store: Store,
  module: string,
  type: string,
  fields: EntityInput["fields"] = {},
  patch: Partial<EntityInput> = {},
) {
  return store.save({
    expectedVersion: 0,
    entity: {
      module,
      type,
      title: "虚构资料 " + type,
      kind: "fact",
      status: "done",
      occurredAt: "2030-04-01",
      timeZone: "Asia/Shanghai",
      fields,
      relations: [],
      body: "原创虚构资料，无真实个人记录。",
      ...patch,
    },
  });
}

test("expression practice saves original Markdown with multiple real goals, material and timed session without duplicate minutes", () => {
  const f = fixture();
  try {
    const material = record(f.store, "learning", "material", {
      author: "Fictional author",
    });
    const session = record(f.store, "learning", "session", {
      minutes: 22,
      takeaway: "虚构阅读与整理",
    });
    const learningGoal = record(
      f.store,
      "learning",
      "goal",
      { measure: "练习解释书架方案" },
      { kind: "plan", status: "active" },
    );
    const projectGoal = record(
      f.store,
      "projects",
      "goal",
      {},
      { kind: "plan", status: "active" },
    );
    const input = createInput("expression-create-linked", {
      structure: structure(material.id),
      materialId: material.id,
      sessionId: session.id,
      goalIds: [learningGoal.id, projectGoal.id, learningGoal.id],
    });
    const created = createExpression(f.store, input);
    assert.equal(created.body, original);
    assert.equal(created.kind, "fact");
    assert.equal(created.status, "active");
    assert.equal(created.fields.revisedText, "");
    assert.equal("minutes" in created.fields, false);
    assert.deepEqual(
      created.relations
        .filter((r) => r.type === "supports")
        .map((r) => r.target)
        .sort(),
      [learningGoal.id, projectGoal.id].sort(),
    );
    assert.ok(
      created.relations.some(
        (r) => r.type === "related" && r.target === material.id,
      ),
    );
    assert.ok(
      created.relations.some(
        (r) => r.type === "evidence" && r.target === session.id,
      ),
    );
    const retry = createExpression(f.store, input);
    assert.equal(retry.id, created.id);
    assert.equal(retry.version, 1);
    assert.throws(
      () =>
        createExpression(f.store, {
          ...input,
          originalText: "同operationId不同内容",
        }),
      /reused/,
    );
    createExpression(
      f.store,
      createInput("expression-second-linked", {
        mode: "口头文字记录",
        sessionId: session.id,
      }),
    );
    const report = expressionReport(f.store.list());
    assert.equal(report.practiceCount, 2);
    assert.deepEqual(report.modes, { 文字: 1, 口头文字记录: 1 });
    assert.deepEqual(report.timedSessionIds, [session.id]);
    assert.equal("minutes" in report, false);
    assert.deepEqual(report.sourceEvidenceIds, [material.id]);
    assert.equal(
      report.rows.find((r) => r.id === created.id)!.goalIds.length,
      2,
    );
    assert.equal(f.store.get(session.id)!.fields.minutes, 22);
  } finally {
    f.close();
  }
});

test("structured revisions preserve the original, support zero or arbitrary reason groups, and replay idempotently after later edits", () => {
  const f = fixture();
  try {
    const practice = createExpression(
      f.store,
      createInput("expression-revise-create"),
    );
    const revision = {
      operationId: "expression-revision-one",
      id: practice.id,
      expectedVersion: practice.version,
      expectedNoteHash: practice.noteHash,
      structure: structure(),
      revisedText: "这是用户自行整理的全文。允许更多句子，也保留疑问。",
    };
    const edited = reviseExpression(f.store, revision);
    assert.equal(edited.body, original);
    assert.equal(edited.version, 2);
    assert.equal(edited.fields.revisedText, revision.revisedText);
    assert.equal(reviseExpression(f.store, revision).version, 2);
    const manyGroups = {
      claim: "",
      groups: Array.from({ length: 7 }, (_, i) => ({
        reason: `虚构理由 ${i + 1}`,
        evidence: [],
      })),
    };
    const second = reviseExpression(f.store, {
      operationId: "expression-revision-two",
      id: edited.id,
      expectedVersion: edited.version,
      expectedNoteHash: edited.noteHash,
      structure: manyGroups,
      status: "done",
    });
    assert.equal(second.body, original);
    assert.equal(second.status, "done");
    assert.equal(JSON.parse(String(second.fields.structure)).groups.length, 7);
    assert.equal(reviseExpression(f.store, revision).version, 3);
    assert.throws(
      () =>
        reviseExpression(f.store, {
          ...revision,
          revisedText: "同一operationId换稿",
        }),
      /reused/,
    );
    assert.throws(
      () =>
        reviseExpression(f.store, {
          ...revision,
          operationId: "expression-conflicting-version",
        }),
      /Version conflict/,
    );
    assert.throws(
      () =>
        reviseExpression(f.store, {
          operationId: "expression-hash-conflict",
          id: second.id,
          expectedVersion: second.version,
          expectedNoteHash: "incorrect-hash",
          revisedText: "整理稿",
        }),
      /Markdown changed/,
    );
    const cleared = reviseExpression(f.store, {
      operationId: "expression-clear-structure",
      id: second.id,
      expectedVersion: second.version,
      expectedNoteHash: second.noteHash,
      structure: { claim: "", groups: [] },
      revisedText: "",
    });
    assert.equal(cleared.body, original);
    assert.equal(expressionFeedback(cleared).coverage.reasonGroups, 0);
    const report = expressionReport([practice, edited, second, cleared]);
    assert.equal(report.practiceCount, 1);
    assert.equal(report.recordedVersionChanges, 3);
    assert.equal(report.unfinished, 0);
  } finally {
    f.close();
  }
});

test("feedback is a read-only inference and distinguishes actual records, suggestions, plans and missing sources without validating claims", () => {
  const f = fixture();
  try {
    const factual = record(f.store, "learning", "note", {
      topic: "虚构试摆记录",
    });
    const suggestion = record(
      f.store,
      "projects",
      "task",
      {},
      { kind: "inference", status: "draft" },
    );
    const plan = record(
      f.store,
      "planning",
      "goal",
      {},
      { kind: "plan", status: "active" },
    );
    const practice = createExpression(
      f.store,
      createInput("expression-feedback-create", {
        structure: {
          claim: "这个方案或许可试",
          groups: [
            {
              reason: "便于观察",
              evidence: [
                { text: "已记录的虚构例子", sourceId: factual.id },
                { text: "建议性依据", sourceId: suggestion.id },
                { text: "尚未执行", sourceId: plan.id },
                { text: "来源待补", sourceId: "missing-fictional-source" },
              ],
            },
            { reason: "便于观察", evidence: [] },
            { reason: "", evidence: [{ text: "" }] },
          ],
        },
      }),
    );
    const before = f.store.backup();
    const feedback = expressionFeedback(practice, f.store.list());
    assert.equal(feedback.kind, "inference");
    assert.equal(feedback.revisedDraft.kind, "inference");
    assert.equal(feedback.revisedDraft.accepted, false);
    assert.equal(feedback.originalText, original);
    assert.equal(feedback.revisedText, "");
    assert.deepEqual(
      feedback.sourceChecks.map((s) => s.status),
      ["fact", "inference", "plan", "missing"],
    );
    for (const code of [
      "duplicate-reason",
      "missing-reason",
      "missing-evidence",
      "empty-evidence",
      "inference-source",
      "plan-source",
      "missing-source",
    ])
      assert.ok(
        feedback.issues.some((i) => i.code === code),
        code,
      );
    assert.equal(feedback.coverage.evidenceItems, 4);
    assert.equal(feedback.coverage.groupsWithEvidence, 1);
    assert.ok(feedback.limitations.some((s) => s.includes("不是事实核验")));
    assert.deepEqual(f.store.backup(), before);
    assert.equal(f.store.get(practice.id)!.fields.revisedText, "");
    assert.ok(
      !practice.relations.some((r) => r.target === "missing-fictional-source"),
    );
  } finally {
    f.close();
  }
});

test("revision adds readable evidence edges, preserves prior links and refuses unreadable private sources and restricted sync packets", () => {
  const f = fixture();
  const peerRoot = join(f.root, "peer");
  const peer = new Store(peerRoot);
  try {
    const material = record(f.store, "learning", "material");
    const session = record(f.store, "learning", "session", { minutes: 11 });
    const privateEvidence = record(f.store, "family", "interaction", {
      activity: "虚构家庭事件",
    });
    const practice = createExpression(
      f.store,
      createInput("expression-link-create", {
        materialId: material.id,
        sessionId: session.id,
      }),
    );
    const limited: Capability = {
      actor: "fictional-editor",
      role: "human",
      read: ["learning"],
      write: ["learning"],
      suggest: [],
    };
    const revise = {
      operationId: "expression-link-revise",
      id: practice.id,
      expectedVersion: practice.version,
      expectedNoteHash: practice.noteHash,
      structure: structure(privateEvidence.id),
    };
    assert.throws(
      () => reviseExpression(f.store, revise, limited),
      /Permission denied/,
    );
    assert.equal(f.store.get(practice.id)!.version, 1);
    const edited = reviseExpression(f.store, revise);
    assert.equal(edited.body, original);
    for (const target of [session.id, privateEvidence.id])
      assert.ok(
        edited.relations.some(
          (r) => r.type === "evidence" && r.target === target,
        ),
      );
    assert.ok(
      edited.relations.some(
        (r) => r.type === "related" && r.target === material.id,
      ),
    );
    assert.throws(
      () =>
        peer.importPacket(f.store.exportPacket(0, ["learning"]), ["learning"]),
      /permission|authorized/i,
    );
    assert.equal(peer.list().length, 0);
  } finally {
    peer.close();
    f.close();
  }
});

test("expression data and idempotency survive restart; AI, module, entity and field permissions remain enforced", () => {
  const f = fixture();
  let closed = false;
  try {
    const originalInput = createInput("expression-restart-create", {
      structure: structure(),
    });
    const practice = createExpression(f.store, originalInput);
    const revision = {
      operationId: "expression-restart-revise",
      id: practice.id,
      expectedVersion: practice.version,
      expectedNoteHash: practice.noteHash,
      revisedText: "用户整理后的虚构全文",
    };
    const edited = reviseExpression(f.store, revision);
    const ai: Capability = {
      actor: "fictional-ai",
      role: "ai",
      read: ["learning"],
      write: [],
      suggest: ["learning"],
    };
    assert.throws(
      () => createExpression(f.store, createInput("expression-ai-denied"), ai),
      /Permission denied|AI/,
    );
    const denied: Capability = {
      actor: "fictional-no-access",
      role: "human",
      read: [],
      write: [],
      suggest: [],
    };
    assert.throws(
      () => reviseExpression(f.store, revision, denied),
      /Permission denied/,
    );
    const fieldLimited: Capability = {
      actor: "fictional-field-editor",
      role: "human",
      read: ["learning"],
      write: ["learning"],
      suggest: [],
      scope: {
        learning: {
          entityIds: [practice.id],
          fields: ["structure"],
          body: false,
          relations: false,
        },
      },
    };
    assert.throws(
      () => reviseExpression(f.store, revision, fieldLimited),
      /Permission denied: field/,
    );
    f.store.close();
    closed = true;
    const reopened = new Store(join(f.root, "data"));
    try {
      assert.equal(reopened.get(practice.id)!.body, original);
      assert.equal(
        reopened.get(practice.id)!.fields.revisedText,
        revision.revisedText,
      );
      assert.equal(createExpression(reopened, originalInput).id, practice.id);
      assert.equal(
        reviseExpression(reopened, revision).version,
        edited.version,
      );
      assert.equal(expressionReport(reopened.list()).practiceCount, 1);
      assert.equal(
        expressionReport(reopened.list()).rows[0].coverage.hasClaim,
        true,
      );
    } finally {
      reopened.close();
    }
  } finally {
    if (!closed) f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("malformed structures fail before writing, while long free text and records with repairable generic edits retain the original", () => {
  const f = fixture();
  try {
    const longOriginal = Array.from(
      { length: 1400 },
      () => "虚构自由写作可以先探索，再考虑组织。\n",
    ).join("");
    const created = createExpression(
      f.store,
      createInput("expression-long-create", { originalText: longOriginal }),
    );
    assert.equal(created.body, longOriginal);
    assert.throws(
      () =>
        createExpression(
          f.store,
          createInput("expression-invalid-create", {
            structure: {
              claim: "草案",
              groups: null,
            } as unknown as ExpressionStructure,
          }),
        ),
      /groups/,
    );
    assert.throws(
      () =>
        createExpression(
          f.store,
          createInput("expression-invalid-mode", {
            mode: "自动麦克风" as "文字",
          }),
        ),
      /mode/,
    );
    assert.equal(f.store.list({ module: "learning" }).length, 1);
    const feedback = expressionFeedback({
      ...created,
      fields: { ...created.fields, structure: "invalid JSON" },
    });
    assert.equal(feedback.originalText, longOriginal);
    assert.ok(feedback.issues.some((i) => i.code === "invalid-structure"));
    assert.equal(
      expressionReport([{ ...created, deleted: true }]).practiceCount,
      0,
    );
    const factGoal = record(
      f.store,
      "learning",
      "goal",
      {},
      { kind: "fact", status: "active" },
    );
    assert.throws(
      () =>
        createExpression(
          f.store,
          createInput("expression-invalid-goal", { goalIds: [factGoal.id] }),
        ),
      /active plan goals/,
    );
  } finally {
    f.close();
  }
});

test("expression receipt replays creation after a goal is done without undoing later human edits, but changed input and revoked access still fail", () => {
  const f = fixture();
  try {
    const goal = record(
      f.store,
      "projects",
      "goal",
      {},
      { kind: "plan", status: "active" },
    );
    const input = createInput("expression-receipt-create", {
      goalIds: [goal.id],
    });
    const created = createExpression(f.store, input);
    f.store.save({
      entity: { ...goal, status: "done" },
      expectedVersion: goal.version,
      expectedNoteHash: goal.noteHash,
    });
    const edited = f.store.save({
      entity: {
        ...created,
        body: original + "\n后续人工保留的新内容。",
        fields: { ...created.fields, revisedText: "后续人工整理稿" },
      },
      expectedVersion: created.version,
      expectedNoteHash: created.noteHash,
    });
    const before = f.store.backup();
    const replayed = createExpression(f.store, input);
    assert.equal(replayed.id, created.id);
    assert.equal(replayed.version, edited.version);
    assert.equal(replayed.body, edited.body);
    assert.equal(replayed.fields.revisedText, edited.fields.revisedText);
    assert.equal(f.store.get(goal.id)!.status, "done");
    assert.deepEqual(f.store.backup(), before);
    assert.throws(
      () =>
        createExpression(f.store, { ...input, title: "复用ID更换用户请求" }),
      /reused/,
    );
    assert.throws(
      () =>
        createExpression(f.store, {
          ...input,
          operationId: "expression-new-create-done-goal",
        }),
      /active plan goals/,
    );
    const revokedGoal: Capability = {
      actor: "revoked-expression-user",
      role: "human",
      read: ["learning"],
      write: ["learning"],
      suggest: [],
    };
    assert.throws(
      () => createExpression(f.store, input, revokedGoal),
      /Permission denied/,
    );
    const revokedEntity: Capability = {
      actor: "revoked-expression-entity",
      role: "human",
      read: ["learning", "projects"],
      write: ["learning"],
      suggest: [],
      scope: { learning: { entityIds: [] }, projects: {} },
    };
    assert.throws(
      () => createExpression(f.store, input, revokedEntity),
      /Permission denied/,
    );
    const revokedFields: Capability = {
      actor: "revoked-expression-fields",
      role: "human",
      read: ["learning", "projects"],
      write: ["learning"],
      suggest: [],
      scope: {
        learning: { fields: ["mode"], body: false, relations: false },
        projects: {},
      },
    };
    assert.throws(
      () => createExpression(f.store, input, revokedFields),
      /Permission denied/,
    );
    assert.deepEqual(f.store.backup(), before);
  } finally {
    f.close();
  }
});

test("expression receipt replays revision after its source is tombstoned without reviving it or overwriting newer revisions", () => {
  const f = fixture();
  try {
    const source = record(f.store, "projects", "task", {
      output: "虚构试摆记录",
    });
    const created = createExpression(
      f.store,
      createInput("expression-receipt-source-create"),
    );
    const revision = {
      operationId: "expression-receipt-source-revise",
      id: created.id,
      expectedVersion: created.version,
      expectedNoteHash: created.noteHash,
      structure: structure(source.id),
      revisedText: "第一次整理稿",
    };
    const revised = reviseExpression(f.store, revision);
    f.store.save({
      entity: { ...source, deleted: true },
      expectedVersion: source.version,
      expectedNoteHash: source.noteHash,
    });
    const latest = reviseExpression(f.store, {
      operationId: "expression-receipt-later-revise",
      id: revised.id,
      expectedVersion: revised.version,
      expectedNoteHash: revised.noteHash,
      revisedText: "用户之后改成的整理稿",
    });
    const before = f.store.backup();
    const replayed = reviseExpression(f.store, revision);
    assert.equal(replayed.version, latest.version);
    assert.equal(replayed.body, original);
    assert.equal(replayed.fields.revisedText, latest.fields.revisedText);
    assert.equal(f.store.get(source.id)!.deleted, true);
    assert.ok(
      replayed.relations.some(
        (r) => r.type === "evidence" && r.target === source.id,
      ),
    );
    assert.deepEqual(f.store.backup(), before);
    assert.throws(
      () =>
        reviseExpression(f.store, { ...revision, revisedText: "同ID改请求" }),
      /reused/,
    );
    const revokedSource: Capability = {
      actor: "revoked-expression-source",
      role: "human",
      read: ["learning"],
      write: ["learning"],
      suggest: [],
    };
    assert.throws(
      () => reviseExpression(f.store, revision, revokedSource),
      /Permission denied/,
    );
    const revokedSourceEntity: Capability = {
      actor: "revoked-source-selection",
      role: "human",
      read: ["learning", "projects"],
      write: ["learning"],
      suggest: [],
      scope: { learning: {}, projects: { entityIds: [] } },
    };
    assert.throws(
      () => reviseExpression(f.store, revision, revokedSourceEntity),
      /Permission denied/,
    );
    assert.deepEqual(f.store.backup(), before);
  } finally {
    f.close();
  }
});
