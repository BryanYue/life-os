import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { builtins } from "../src/modules.js";
import { hash } from "../src/vault.js";
import { allocate } from "../src/planner.js";
import { addDecimal, summary, acceptPlan } from "../src/domain.js";
import type {
  EntityInput,
  Module,
  PlanInput,
  SyncPacket,
  Capability,
} from "../src/types.js";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "life-test-"));
  const s = new Store(join(root, "a"));
  return {
    root,
    s,
    close: () => {
      s.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
const input = (
  module = "planning",
  type = "goal",
  fields: EntityInput["fields"] = {},
): EntityInput => ({
  module,
  type,
  title: "Fictional sample",
  kind: "plan",
  status: "active",
  occurredAt: "2030-04-01",
  timeZone: "UTC",
  fields,
  relations: [],
  body: "First line\nMiddle line\nLast line\n",
});
const save = (s: Store, e: EntityInput) =>
  s.save({ entity: e, expectedVersion: 0 });
const edit = (s: Store, id: string, patch: Partial<EntityInput>) => {
  const e = s.get(id)!;
  return s.save({
    entity: { ...e, ...patch },
    expectedVersion: e.version,
    expectedNoteHash: e.noteHash,
  });
};
const resign = (p: SyncPacket) => {
  const rest = { ...p } as Partial<SyncPacket>;
  delete rest.sha256;
  return { ...p, sha256: hash(JSON.stringify(rest)) };
};
for (const m of builtins)
  test("D01–D08 workflow: " + m.id, () => {
    const f = fixture();
    try {
      const g = save(f.s, input(m.id));
      const business = m.entityTypes.find(
        (t) => !["goal", "review"].includes(t.id),
      )!;
      const fields: EntityInput["fields"] = {};
      for (const x of business.fields.filter((x) => x.required))
        fields[x.key] =
          x.type === "number"
            ? 12
            : x.type === "select"
              ? x.options![0]
              : x.type === "decimal"
                ? "0.10"
                : x.type === "date"
                  ? "2030-04-01"
                  : x.key === "currency"
                    ? "USD"
                    : "Fictional";
      const actual = save(f.s, {
        ...input(m.id, business.id, fields),
        kind: "fact",
        relations: [{ type: "actual-of", target: g.id }],
      });
      const changed = edit(f.s, actual.id, {
        title: "Changed fictional record",
      });
      assert.equal(changed.version, 2);
      const review = save(f.s, {
        ...input(m.id, "review", { feeling: "Steady", next: "Repeat gently" }),
        kind: "fact",
        relations: [{ type: "evidence", target: actual.id }],
        body: "Compared plan with actual.\n",
      });
      assert.equal(f.s.list({ module: m.id, q: "Changed" }).length, 1);
      assert.equal(f.s.get(review.id)!.relations[0].target, actual.id);
      assert.equal(summary(f.s.list({ module: m.id })).counts.fact, 2);
      f.s.close();
      const reopened = new Store(join(f.root, "a"));
      assert.equal(
        reopened.get(review.id)!.body,
        "Compared plan with actual.\n",
      );
      reopened.close();
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
test("note moves retain stable identity, unknown frontmatter survives, stale save is rejected", () => {
  const f = fixture();
  try {
    let e = save(f.s, input());
    const p = f.s.vault.locate(e.id)!;
    writeFileSync(
      p,
      readFileSync(p, "utf8").replace("life_id:", "custom: keep-me\nlife_id:"),
    );
    mkdirSync(join(f.s.vault.root, "moved"));
    renameSync(p, join(f.s.vault.root, "moved", "renamed.md"));
    assert.throws(
      () =>
        f.s.save({
          entity: { ...e, body: "stale" },
          expectedVersion: e.version,
          expectedNoteHash: e.noteHash,
        }),
      /externally/,
    );
    e = edit(f.s, e.id, { body: "Updated intentionally" });
    assert.equal(f.s.get(e.id)!.body, "Updated intentionally");
    assert.match(
      readFileSync(f.s.vault.locate(e.id)!, "utf8"),
      /custom: keep-me/,
    );
  } finally {
    f.close();
  }
});
test("symlink and malformed note errors are visible and never followed", () => {
  const f = fixture();
  try {
    const e = save(f.s, input());
    symlinkSync(f.root, join(f.s.vault.root, "escape"));
    assert.throws(() => f.s.get(e.id), /symlink/);
    rmSync(join(f.s.vault.root, "escape"));
    writeFileSync(f.s.vault.locate(e.id)!, "---\nbad: [\n---\nuser text");
    assert.throws(() => f.s.get(e.id), /frontmatter/);
  } finally {
    f.close();
  }
});
test("version conflict and tombstone recovery", () => {
  const f = fixture();
  try {
    const e = save(f.s, input());
    edit(f.s, e.id, { title: "new" });
    assert.throws(
      () =>
        f.s.save({
          entity: e,
          expectedVersion: 1,
          expectedNoteHash: e.noteHash,
        }),
      /Version conflict/,
    );
    edit(f.s, e.id, { deleted: true });
    assert.equal(f.s.list().length, 0);
    assert.equal(f.s.list({ includeDeleted: true }).length, 1);
    edit(f.s, e.id, { deleted: false });
    assert.equal(f.s.list().length, 1);
  } finally {
    f.close();
  }
});
test("source import retries deduplicate and source revisions update the same record", () => {
  const f = fixture();
  try {
    const e = {
      ...input("health", "session", {
        activity: "Synthetic walk",
        minutes: 10,
        measurement: "设备测量",
      }),
      kind: "fact" as const,
      source: {
        namespace: "synthetic-export",
        recordId: "sample-1",
        revision: "1",
        mode: "import" as const,
      },
    };
    const first = f.s.importSource(e);
    assert.equal(f.s.importSource(e).id, first.id);
    assert.equal(f.s.list().length, 1);
    const revised = f.s.importSource({
      ...e,
      fields: { ...e.fields, minutes: 12 },
      source: { ...e.source, revision: "2" },
    });
    assert.equal(revised.id, first.id);
    assert.equal(revised.version, 2);
    assert.throws(
      () => f.s.importSource({ ...e, source: { ...e.source, revision: "2" } }),
      /revision/,
    );
  } finally {
    f.close();
  }
});
test("AI grants constrain reads and can only create draft suggestions; kind is immutable", () => {
  const f = fixture();
  try {
    const e = save(
      f.s,
      input("finance", "entry", {
        amount: "1.01",
        currency: "USD",
        category: "Demo",
      }),
    );
    const cap: Capability = {
      actor: "test-agent",
      role: "ai",
      read: ["planning"],
      write: [],
      suggest: ["planning"],
    };
    assert.equal(f.s.list({}, cap).length, 0);
    assert.throws(() => f.s.get(e.id, cap), /Permission/);
    assert.throws(
      () => f.s.save({ entity: input(), expectedVersion: 0 }, cap),
      /AI may/,
    );
    const suggestion = f.s.save(
      {
        entity: { ...input(), kind: "inference", status: "draft" },
        expectedVersion: 0,
      },
      cap,
    );
    assert.equal(suggestion.kind, "inference");
    assert.throws(
      () => edit(f.s, suggestion.id, { kind: "fact" }),
      /immutable/,
    );
    assert.throws(
      () =>
        f.s.save(
          {
            entity: { ...input("family"), kind: "inference", status: "draft" },
            expectedVersion: 0,
          },
          cap,
        ),
      /Permission/,
    );
  } finally {
    f.close();
  }
});
test("sync offline changes merge disjoint fields and Markdown lines, dedup retries", () => {
  const f = fixture();
  const b = new Store(join(f.root, "b"));
  try {
    const e = save(f.s, input());
    b.importPacket(f.s.exportPacket(0, ["planning"]), ["planning"]);
    edit(f.s, e.id, {
      title: "A title",
      body: "A changed\nMiddle line\nLast line\n",
    });
    edit(b, e.id, {
      status: "done",
      body: "First line\nMiddle line\nB changed\n",
    });
    const p = f.s.exportPacket(1, ["planning"]);
    assert.equal(b.importPacket(p, ["planning"]).applied, 1);
    const merged = b.get(e.id)!;
    assert.equal(merged.title, "A title");
    assert.equal(merged.status, "done");
    assert.equal(merged.body, "A changed\nMiddle line\nB changed\n");
    assert.equal(b.importPacket(p, ["planning"]).applied, 0);
  } finally {
    b.close();
    f.close();
  }
});
test("sync conflicting field preserves both, resolves as new version and replays safely", () => {
  const f = fixture();
  const b = new Store(join(f.root, "b"));
  try {
    const e = save(f.s, input());
    b.importPacket(f.s.exportPacket(0, ["planning"]), ["planning"]);
    edit(f.s, e.id, { title: "A" });
    edit(b, e.id, { title: "B" });
    const p = f.s.exportPacket(1, ["planning"]);
    assert.equal(b.importPacket(p, ["planning"]).conflicts, 1);
    assert.equal(b.get(e.id)!.title, "B");
    assert.equal(b.conflicts()[0].operation.value.title, "A");
    b.resolveConflict(b.conflicts()[0].id, "incoming");
    assert.equal(b.get(e.id)!.title, "A");
    assert.equal(b.conflicts().length, 0);
    assert.equal(b.importPacket(p, ["planning"]).applied, 0);
  } finally {
    b.close();
    f.close();
  }
});
test("tamper, protocol, gaps and permission failures leave cursor and entities unchanged", () => {
  const f = fixture();
  const b = new Store(join(f.root, "b"));
  try {
    save(f.s, input());
    save(f.s, input("health", "goal"));
    const p = f.s.exportPacket(0, ["planning", "health"]);
    assert.throws(
      () => b.importPacket({ ...p, to: 99 }, ["planning", "health"]),
      /packet/,
    );
    assert.throws(
      () =>
        b.importPacket(resign({ ...p, from: 5, to: 7 }), [
          "planning",
          "health",
        ]),
      /gap/,
    );
    assert.throws(() => b.importPacket(p, ["planning"]), /permission/);
    assert.equal(b.list().length, 0);
    assert.equal(b.db.prepare("SELECT COUNT(*) AS n FROM cursors").get()!.n, 0);
    assert.equal(b.importPacket(p, ["planning", "health"]).applied, 2);
    save(f.s, input("family"));
    assert.equal(f.s.exportPacket(0, ["family"]).operations.length, 0);
  } finally {
    b.close();
    f.close();
  }
});
test("delete versus offline edit produces conflict instead of resurrection", () => {
  const f = fixture();
  const b = new Store(join(f.root, "b"));
  try {
    const e = save(f.s, input());
    b.importPacket(f.s.exportPacket(0, ["planning"]), ["planning"]);
    edit(f.s, e.id, { deleted: true });
    edit(b, e.id, { title: "Offline edit" });
    assert.equal(
      b.importPacket(f.s.exportPacket(1, ["planning"]), ["planning"]).conflicts,
      1,
    );
    b.resolveConflict(b.conflicts()[0].id, "incoming");
    assert.equal(b.list().length, 0);
  } finally {
    b.close();
    f.close();
  }
});
test("crash after SQLite commit replays the note journal on restart", () => {
  const f = fixture();
  const e = save(f.s, input());
  f.s.faultAfterCommit = () => {
    throw Error("simulated crash");
  };
  assert.throws(() => edit(f.s, e.id, { body: "Committed note" }), /crash/);
  f.s.close();
  const reopened = new Store(join(f.root, "a"));
  try {
    assert.equal(reopened.get(e.id)!.body, "Committed note");
    assert.equal(
      reopened.db.prepare("SELECT COUNT(*) AS n FROM pending_notes").get()!.n,
      0,
    );
  } finally {
    reopened.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
test("backup recovery includes relations, moved notes, source state, cursors; old sync replay is harmless", () => {
  const f = fixture();
  const b = new Store(join(f.root, "b"));
  let restored: Store | undefined;
  try {
    const e = save(f.s, input());
    save(f.s, {
      ...input("health"),
      relations: [{ type: "supports", target: e.id }],
    });
    const packet = f.s.exportPacket(0, ["planning", "health"]);
    b.importPacket(packet, ["planning", "health"]);
    const backup = b.backup();
    assert.throws(
      () => Store.restore(join(f.root, "bad"), { ...backup, sha256: "bad" }),
      /checksum/,
    );
    restored = Store.restore(join(f.root, "restored"), backup);
    assert.deepEqual(restored.list(), b.list());
    assert.equal(
      restored.importPacket(packet, ["planning", "health"]).applied,
      0,
    );
    assert.notEqual(restored.device, b.device);
  } finally {
    restored?.close();
    b.close();
    f.close();
  }
});
test("plants register without core edits; public/private coexist; schema migration rolls back and backup restores", () => {
  const f = fixture();
  let restored: Store | undefined;
  try {
    const plant = JSON.parse(
      readFileSync("examples/plants.json", "utf8"),
    ) as Module;
    f.s.register(plant);
    f.s.register({ ...plant, id: "private.garden", codeVisibility: "private" });
    const e = save(f.s, input(plant.id, "care", { waterMl: 100 }));
    const next = structuredClone(plant);
    next.schemaVersion = 2;
    next.version = "0.2.0";
    next.entityTypes.find((t) => t.id === "care")!.fields = [
      {
        key: "waterMillilitres",
        label: "水量",
        type: "number",
        required: true,
      },
    ];
    assert.throws(() => f.s.migrateModule(next), /Invalid fields/);
    assert.equal(f.s.module(plant.id).schemaVersion, 1);
    assert.equal(f.s.get(e.id)!.fields.waterMl, 100);
    const result = f.s.migrateModule(next, { waterMl: "waterMillilitres" });
    assert.equal(f.s.get(e.id)!.fields.waterMillilitres, 100);
    restored = Store.restore(
      join(f.root, "migration-restore"),
      JSON.parse(readFileSync(result.backup, "utf8")),
    );
    assert.equal(restored.get(e.id)!.fields.waterMl, 100);
    f.s.setEnabled(plant.id, false);
    assert.equal(f.s.get(e.id)!.fields.waterMillilitres, 100);
    assert.throws(() => edit(f.s, e.id, { title: "denied" }), /disabled/);
  } finally {
    restored?.close();
    f.close();
  }
});
test("D07 decimal totals stay exact and currencies/category remain separate", () => {
  assert.equal(addDecimal("0.1", "0.2"), "0.3");
  assert.equal(addDecimal("9007199254740993.01", "0.09"), "9007199254740993.1");
  const f = fixture();
  try {
    for (const [amount, currency] of [
      ["0.1", "USD"],
      ["0.2", "USD"],
      ["4", "JPY"],
    ])
      save(f.s, {
        ...input("finance", "entry", { amount, currency, category: "Demo" }),
        kind: "fact",
      });
    assert.deepEqual(
      summary(f.s.list()).finance,
      [
        { currency: "USD", category: "Demo", total: "0.3" },
        { currency: "JPY", category: "Demo", total: "4" },
      ].sort((a, b) => a.currency.localeCompare(b.currency)),
    );
  } finally {
    f.close();
  }
});
test("D01 all scenarios preserve protected intervals, buffers and multiple goals; acceptance is explicit", () => {
  const f = fixture();
  try {
    const p: PlanInput = {
      date: "2030-04-01",
      timeZone: "Asia/Tokyo",
      scenario: "normal",
      startMinute: 0,
      endMinute: 600,
      protected: [{ label: "Fixed", start: 100, end: 200 }],
      buffers: {
        meals: 30,
        commute: 20,
        preparation: 10,
        recovery: 20,
        sleep: 100,
      },
      goals: [
        { id: "demo-a", title: "A", minutes: 100 },
        { id: "demo-b", title: "B", minutes: 100 },
      ],
    };
    let previous = Infinity;
    for (const scenario of ["normal", "overtime", "fatigue"] as const) {
      const draft = allocate({ ...p, scenario });
      const used = draft.slots.reduce((n, s) => n + s.end - s.start, 0);
      assert.ok(used <= previous);
      previous = used;
      assert.ok(draft.slots.every((s) => s.end <= 100 || s.start >= 200));
      assert.equal(new Set(draft.slots.map((s) => s.goalId)).size, 2);
      assert.equal(f.s.list().length, 0);
    }
    const draft = allocate(p);
    assert.ok(acceptPlan(f.s, draft).length > 0);
    assert.equal(
      f.s.list().every((e) => e.kind === "plan"),
      true,
    );
    const impossible = allocate({
      ...p,
      buffers: { ...p.buffers, sleep: 900 },
    });
    assert.equal(impossible.slots.length, 0);
    assert.ok(impossible.issues.length);
  } finally {
    f.close();
  }
});
test("review regression: complete idempotency fingerprint and permission recheck", () => {
  const f = fixture();
  try {
    const req = {
      entity: input(),
      expectedVersion: 0,
      operationId: "stable-operation",
    };
    const e = f.s.save(req);
    assert.equal(f.s.save(req).id, e.id);
    for (const patch of [
      { status: "done" as const },
      { deleted: true },
      { id: "different-id" },
      { timeZone: "Asia/Tokyo" },
      { relations: [{ type: "related", target: e.id }] },
    ])
      assert.throws(
        () => f.s.save({ ...req, entity: { ...req.entity, ...patch } }),
        /different content/,
      );
    const cap: Capability = {
      actor: "denied",
      role: "human",
      read: ["planning"],
      write: [],
      suggest: [],
    };
    assert.throws(() => f.s.save(req, cap), /Permission/);
  } finally {
    f.close();
  }
});
test("review regression: conflict resolution propagates both local and incoming selections", () => {
  for (const choice of ["local", "incoming"] as const) {
    const f = fixture(),
      b = new Store(join(f.root, "b"));
    try {
      const e = save(f.s, input());
      b.importPacket(f.s.exportPacket(0, ["planning"]), ["planning"]);
      edit(f.s, e.id, { title: "A choice" });
      edit(b, e.id, { title: "B choice" });
      b.importPacket(f.s.exportPacket(1, ["planning"]), ["planning"]);
      b.resolveConflict(b.conflicts()[0].id, choice);
      f.s.importPacket(b.exportPacket(0, ["planning"]), ["planning"]);
      assert.equal(f.s.get(e.id)!.title, b.get(e.id)!.title);
      assert.equal(f.s.conflicts().length, 0);
      b.importPacket(f.s.exportPacket(0, ["planning"]), ["planning"]);
      assert.equal(b.conflicts().length, 0);
    } finally {
      b.close();
      f.close();
    }
  }
});
test("review regression: sync cannot retag an existing private entity", () => {
  const f = fixture();
  try {
    const e = save(f.s, input("family"));
    const base = f.s.snapshot(e.id)!;
    const value = {
      ...base,
      module: "planning",
      markdown: base.markdown.replace(
        "life_module: family",
        "life_module: planning",
      ),
    };
    const p = resign({
      protocol: 1,
      batchId: "test-batch",
      device: "test-peer",
      from: 0,
      to: 1,
      complete: true,
      operations: [
        {
          id: "retag",
          device: "test-peer",
          sequence: 1,
          entityId: e.id,
          base,
          value,
          at: new Date().toISOString(),
        },
      ],
      sha256: "",
    });
    assert.throws(() => f.s.importPacket(p, ["planning"]), /permission/);
    assert.equal(f.s.get(e.id)!.module, "family");
  } finally {
    f.close();
  }
});
test("review regression: external edit after committed crash remains recoverable", () => {
  const f = fixture();
  const e = save(f.s, input());
  const path = f.s.vault.locate(e.id)!;
  f.s.faultAfterCommit = () => {
    throw Error("crash");
  };
  assert.throws(() => edit(f.s, e.id, { body: "Pending intended text" }));
  writeFileSync(
    path,
    readFileSync(path, "utf8").replace("First line", "External text"),
  );
  f.s.close();
  const recovering = new Store(join(f.root, "a"), { skipNoteRecovery: true });
  try {
    assert.throws(() => recovering.flushNotes(), /Pending Markdown conflict/);
    recovering.recoverNote(e.id, "external");
    assert.match(recovering.get(e.id)!.body, /External text/);
  } finally {
    recovering.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
test("review regression: disabled module backup remains readable after restore", () => {
  const f = fixture();
  let restored: Store | undefined;
  try {
    const e = save(f.s, input());
    f.s.setEnabled("planning", false);
    restored = Store.restore(join(f.root, "restored-disabled"), f.s.backup());
    assert.equal(restored.module("planning", false).enabled, false);
    assert.equal(restored.get(e.id)!.title, e.title);
  } finally {
    restored?.close();
    f.close();
  }
});
test("D03 full learning-to-project chain and moved note", () => {
  const f = fixture();
  try {
    const g = save(f.s, input("learning"));
    const material = save(f.s, {
      ...input("learning", "material", {
        author: "Fictional author",
        progress: 25,
      }),
      relations: [{ type: "supports", target: g.id }],
    });
    const session = save(f.s, {
      ...input("learning", "session", {
        minutes: 15,
        takeaway: "A synthetic insight",
      }),
      kind: "fact",
      relations: [{ type: "related", target: material.id }],
    });
    const note = save(f.s, {
      ...input("learning", "note", { topic: "Demo" }),
      relations: [{ type: "evidence", target: session.id }],
    });
    const project = save(
      f.s,
      input("projects", "project", {
        problem: "Synthetic question",
        evaluation: "Local test",
      }),
    );
    const out = save(f.s, {
      ...input("learning", "output", { reference: "example://output" }),
      kind: "fact",
      relations: [
        { type: "related", target: project.id },
        { type: "evidence", target: note.id },
      ],
    });
    save(f.s, {
      ...input("learning", "review", { period: "Fictional week" }),
      relations: [{ type: "evidence", target: out.id }],
    });
    renameSync(
      f.s.vault.locate(note.id)!,
      join(f.s.vault.root, "renamed-knowledge.md"),
    );
    assert.equal(f.s.get(out.id)!.relations[1].target, note.id);
    assert.equal(f.s.get(note.id)!.body, note.body);
    assert.equal(f.s.list({ module: "learning" }).length, 6);
  } finally {
    f.close();
  }
});
test("D04/D06 two versioned experiments retain hypotheses, parameters and actual evaluation", () => {
  const f = fixture();
  try {
    for (const module of ["projects", "quant"]) {
      const fields: EntityInput["fields"] =
        module === "quant"
          ? {
              hypothesis: "Synthetic hypothesis",
              experimentVersion: "v1",
              datasetVersion: "fixture-v1",
              codeRef: "example-commit-1",
              parameters: '{"window":5}',
              costs: "fee 0.1%; slippage 0.05%",
              result: "synthetic backtest, not executed trading",
              risk: "fictional dataset",
            }
          : {
              experimentVersion: "v1",
              codeRef: "example-commit-1",
              parameters: '{"prompt":"a"}',
              evaluation: "one synthetic test passed",
              result: "fixture only",
            };
      const one = save(f.s, {
        ...input(module, "experiment", fields),
        kind: "fact",
        status: "done",
      });
      const two = save(f.s, {
        ...input(module, "experiment", {
          ...fields,
          experimentVersion: "v2",
          parameters: '{"window":10}',
          result: "failed synthetic run",
        }),
        kind: "fact",
        status: "failed",
        relations: [{ type: "related", target: one.id }],
      });
      assert.notEqual(one.fields.parameters, two.fields.parameters);
      assert.equal(f.s.list({ module }).length, 2);
      assert.equal(f.s.get(one.id)!.status, "done");
      assert.equal(f.s.get(two.id)!.status, "failed");
    }
  } finally {
    f.close();
  }
});
test("D05 language goals and factual totals are independent", () => {
  const f = fixture();
  try {
    const en = save(
      f.s,
      input("languages", "language-goal", {
        language: "英语",
        measure: "Small practice",
      }),
    );
    const ja = save(
      f.s,
      input("languages", "language-goal", {
        language: "日语",
        measure: "Small practice",
      }),
    );
    save(f.s, {
      ...input("languages", "practice", {
        language: "英语",
        skill: "听",
        minutes: 12,
      }),
      kind: "fact",
      relations: [{ type: "supports", target: en.id }],
    });
    const fact = save(f.s, {
      ...input("languages", "practice", {
        language: "日语",
        skill: "读",
        minutes: 8,
      }),
      kind: "fact",
      relations: [{ type: "supports", target: ja.id }],
    });
    edit(f.s, en.id, { fields: { language: "英语", measure: "Changed goal" } });
    assert.equal(f.s.get(fact.id)!.version, 1);
    assert.deepEqual(summary(f.s.list()).minutesByLanguage, {
      英语: 12,
      日语: 8,
    });
  } finally {
    f.close();
  }
});
test("atomic plan acceptance retries do not duplicate confirmed actions", () => {
  const f = fixture();
  try {
    const p: PlanInput = {
      date: "2030-01-01",
      timeZone: "UTC",
      scenario: "normal",
      startMinute: 0,
      endMinute: 120,
      protected: [],
      buffers: { meals: 0, commute: 0, preparation: 0, recovery: 0, sleep: 0 },
      goals: [{ id: "a", title: "Synthetic goal", minutes: 15 }],
    };
    const draft = allocate(p);
    const first = acceptPlan(f.s, draft);
    assert.equal(acceptPlan(f.s, draft)[0].id, first[0].id);
    assert.equal(f.s.list().length, 1);
  } finally {
    f.close();
  }
});
test("external Markdown edits become incremental operations and merge on another replica", () => {
  const f = fixture(),
    b = new Store(join(f.root, "b"));
  try {
    const e = save(f.s, input());
    b.importPacket(f.s.exportPacket(0, ["planning"]), ["planning"]);
    const p = f.s.vault.locate(e.id)!;
    writeFileSync(
      p,
      readFileSync(p, "utf8").replace("First line", "External first"),
    );
    edit(b, e.id, { body: "First line\nMiddle line\nApp last\n" });
    b.importPacket(f.s.exportPacket(1, ["planning"]), ["planning"]);
    assert.equal(b.get(e.id)!.body, "External first\nMiddle line\nApp last\n");
    assert.equal(f.s.audit().at(-1)!.action, "external-note");
  } finally {
    b.close();
    f.close();
  }
});
