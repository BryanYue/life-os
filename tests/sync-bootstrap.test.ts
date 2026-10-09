import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/store.js";
import {
  exportBootstrap,
  importBootstrap,
  exportProjection,
  importProjection,
  listProjections,
} from "../src/sync.js";
import { hash } from "../src/vault.js";
import type {
  Capability,
  EntityInput,
  Module,
  SyncScope,
} from "../src/types.js";
const input = (extra: Partial<EntityInput> = {}): EntityInput => ({
  module: "planning",
  type: "goal",
  title: "Synthetic private goal",
  kind: "plan",
  status: "active",
  occurredAt: "2030-01-01",
  timeZone: "UTC",
  fields: { horizon: "private horizon", measure: "shared measure" },
  relations: [],
  body: "Synthetic private body",
  ...extra,
});
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, canonical(x)]),
        )
      : v;
const resign = <T extends { sha256: string }>(p: T) => ({
  ...p,
  sha256: hash(JSON.stringify(canonical({ ...p, sha256: undefined }))),
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "life-baseline-")),
    a = new Store(join(root, "a")),
    b = new Store(join(root, "b"));
  return {
    root,
    a,
    b,
    close() {
      a.close();
      b.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("current-schema bootstrap initializes an empty peer after migration, replays old operations and converges new offline edits", () => {
  const f = fixture();
  try {
    const m = JSON.parse(
      readFileSync("examples/plants.json", "utf8"),
    ) as Module;
    f.a.register(m);
    const e = f.a.importSource(
      input({
        module: m.id,
        type: "care",
        fields: { waterMl: 100 },
        source: {
          namespace: "synthetic-garden",
          recordId: "one",
          revision: "r1",
          mode: "import",
        },
      }),
    );
    const next = structuredClone(m);
    next.version = "0.2.0";
    next.schemaVersion = 2;
    next.entityTypes.find((t) => t.id === "care")!.fields = [
      { key: "waterMillilitres", label: "水量", type: "number" },
    ];
    f.a.migrateModule(next, { waterMl: "waterMillilitres" });
    const packet = exportBootstrap(f.a, [m.id]);
    assert.throws(
      () => importBootstrap(f.b, packet, [m.id]),
      /manifest acceptance/,
    );
    assert.equal(f.b.list().length, 0);
    assert.equal(
      f.b.modules().some((x) => x.id === m.id),
      false,
    );
    assert.equal(
      importBootstrap(f.b, packet, [m.id], { acceptManifests: true }).applied,
      1,
    );
    assert.equal(f.b.get(e.id)!.fields.waterMillilitres, 100);
    assert.equal(
      f.b.importPacket(f.a.exportPacket(0, [m.id]), [m.id]).applied,
      0,
    );
    assert.equal(importBootstrap(f.b, packet, [m.id]).applied, 0);
    const left = f.a.get(e.id)!,
      right = f.b.get(e.id)!;
    f.a.save({
      entity: { ...left, title: "Changed source title" },
      expectedVersion: left.version,
      expectedNoteHash: left.noteHash,
    });
    f.b.save({
      entity: { ...right, body: "Receiver offline note" },
      expectedVersion: right.version,
      expectedNoteHash: right.noteHash,
    });
    f.b.importPacket(f.a.exportPacket(packet.cursor, [m.id]), [m.id]);
    f.a.importPacket(f.b.exportPacket(0, [m.id]), [m.id]);
    assert.equal(f.a.conflicts().length, 0);
    assert.equal(f.b.conflicts().length, 0);
    assert.equal(f.a.get(e.id)!.body, "Receiver offline note");
    assert.equal(f.b.get(e.id)!.title, "Changed source title");
    const revised = f.b.importSource(
      input({
        module: m.id,
        type: "care",
        fields: { waterMillilitres: 120 },
        source: {
          namespace: "synthetic-garden",
          recordId: "one",
          revision: "r2",
          mode: "import",
        },
      }),
    );
    assert.equal(revised.id, e.id);
    assert.equal(f.b.list().length, 1);
  } finally {
    f.close();
  }
});
test("bootstrap preserves relations independent of snapshot order, rejects existing IDs and rolls schema/data/cursors back on invalid contents", () => {
  const f = fixture();
  try {
    const goal = f.a.save({ entity: input(), expectedVersion: 0 });
    f.a.save({
      entity: input({
        type: "review",
        fields: { next: "Synthetic" },
        kind: "fact",
        relations: [{ type: "evidence", target: goal.id }],
      }),
      expectedVersion: 0,
    });
    const good = exportBootstrap(f.a, ["planning"]);
    const bad = structuredClone(good);
    bad.records[0].fields.unknown = "denied";
    assert.throws(
      () => importBootstrap(f.b, resign(bad), ["planning"]),
      /Invalid fields/,
    );
    assert.equal(f.b.list().length, 0);
    assert.equal(f.b.db.prepare("SELECT * FROM cursors").all().length, 0);
    const reordered = resign({ ...good, records: good.records.toReversed() });
    assert.equal(importBootstrap(f.b, reordered, ["planning"]).applied, 2);
    assert.equal(
      f.b.list({ module: "planning" }).find((e) => e.type === "review")!
        .relations[0].target,
      goal.id,
    );
    assert.throws(
      () =>
        importBootstrap(f.b, exportBootstrap(f.a, ["planning"]), ["planning"]),
      /existing data is preserved/,
    );
    const restricted: SyncScope = {
      modules: ["planning"],
      entities: { planning: { entityIds: [goal.id] } },
    };
    assert.equal(exportBootstrap(f.a, restricted).records.length, 1);
    const unauthorized = new Store(join(f.root, "unauthorized"));
    try {
      assert.throws(
        () => importBootstrap(unauthorized, good, { modules: [] }),
        /permission/,
      );
    } finally {
      unauthorized.close();
    }
  } finally {
    f.close();
  }
});
test("entity and field grants hide metadata/body/hash, deny hidden changes, and permit a scoped field patch without deleting private data", () => {
  const f = fixture();
  try {
    const e = f.a.save({ entity: input(), expectedVersion: 0 });
    const other = f.a.save({
      entity: input({ title: "Excluded entity" }),
      expectedVersion: 0,
    });
    const cap: Capability = {
      actor: "synthetic-limited",
      role: "human",
      read: ["planning"],
      write: ["planning"],
      suggest: [],
      scope: { planning: { entityIds: [e.id], fields: ["measure"] } },
    };
    const projected = f.a.get(e.id, cap)!;
    assert.deepEqual(projected.fields, { measure: "shared measure" });
    assert.equal(projected.body, "");
    assert.equal(projected.title, "");
    assert.equal(projected.noteHash, "");
    assert.equal(projected.source.namespace, "redacted");
    assert.equal(f.a.list({}, cap).length, 1);
    assert.equal(f.a.list({ q: "private" }, cap).length, 0);
    assert.throws(() => f.a.get(other.id, cap), /Permission/);
    assert.throws(
      () => f.a.patchFields(e.id, { horizon: "leak" }, e.version, cap),
      /Permission/,
    );
    const changed = f.a.patchFields(
      e.id,
      { measure: "Shared update" },
      e.version,
      cap,
    );
    assert.equal(changed.fields.measure, "Shared update");
    assert.equal(changed.body, "");
    const full = f.a.get(e.id)!;
    assert.equal(full.body, e.body);
    assert.equal(full.fields.horizon, e.fields.horizon);
    assert.throws(
      () => f.a.patchFields(e.id, { measure: "stale" }, e.version, cap),
      /Version conflict/,
    );
    assert.throws(
      () =>
        f.a.patchFields(e.id, { measure: "AI write" }, full.version, {
          ...cap,
          role: "ai",
        }),
      /AI may/,
    );
  } finally {
    f.close();
  }
});
test("field projections are isolated read-only replicas, reject leakage and tamper, and update/delete without erasing local records", () => {
  const f = fixture();
  let restored: Store | undefined;
  try {
    const e = f.a.save({ entity: input(), expectedVersion: 0 });
    const scope: SyncScope = {
      modules: ["planning"],
      entities: { planning: { entityIds: [e.id], fields: ["measure"] } },
    };
    assert.throws(() => exportBootstrap(f.a, scope), /read-only projection/);
    assert.throws(() => f.a.exportPacket(0, scope), /read-only projection/);
    const packet = exportProjection(f.a, scope);
    assert.equal(JSON.stringify(packet).includes("Synthetic private"), false);
    assert.equal(JSON.stringify(packet).includes("private horizon"), false);
    assert.equal(importProjection(f.b, packet, scope).applied, 1);
    assert.equal(f.b.list().length, 0);
    assert.equal(importProjection(f.b, packet, scope).applied, 0);
    const leak = structuredClone(packet);
    leak.records[0].body = "forbidden";
    assert.throws(
      () => importProjection(f.b, resign(leak), scope),
      /outside receiver/,
    );
    f.a.save({
      entity: {
        ...e,
        fields: { ...e.fields, measure: "new value" },
        deleted: true,
      },
      expectedVersion: e.version,
      expectedNoteHash: e.noteHash,
    });
    assert.equal(
      importProjection(f.b, exportProjection(f.a, scope), scope).applied,
      1,
    );
    assert.equal(listProjections(f.b)[0].records[0].deleted, true);
    assert.equal(
      listProjections(f.b)[0].records[0].fields.measure,
      "new value",
    );
    assert.equal(importProjection(f.b, packet, scope).stale, true);
    restored = Store.restore(join(f.root, "restored"), f.b.backup());
    assert.equal(listProjections(restored)[0].records[0].deleted, true);
  } finally {
    restored?.close();
    f.close();
  }
});

test("bootstrap refuses an orphan managed note before committing any record or cursor", () => {
  const f = fixture();
  try {
    const e = f.a.save({ entity: input(), expectedVersion: 0 }),
      packet = exportBootstrap(f.a, ["planning"]);
    f.b.vault.write(
      e.id,
      f.b.vault.compose(e.id, e.module, "Synthetic orphan body"),
    );
    assert.throws(
      () => importBootstrap(f.b, packet, ["planning"]),
      /orphan Markdown/,
    );
    assert.equal(f.b.list().length, 0);
    assert.equal(f.b.db.prepare("SELECT * FROM cursors").all().length, 0);
    assert.equal(f.b.db.prepare("SELECT * FROM pending_notes").all().length, 0);
    assert.equal(f.b.vault.read(e.id)!.body, "Synthetic orphan body");
  } finally {
    f.close();
  }
});
test("three replicas retain inherited operation receipts through another bootstrap and restore", () => {
  const f = fixture();
  let c: Store | undefined, restored: Store | undefined;
  try {
    c = new Store(join(f.root, "c"));
    const e = f.a.save({ entity: input(), expectedVersion: 0 });
    f.a.save({
      entity: { ...e, title: "Latest synthetic title" },
      expectedVersion: e.version,
      expectedNoteHash: e.noteHash,
    });
    importBootstrap(f.b, exportBootstrap(f.a, ["planning"]), ["planning"]);
    importBootstrap(c, exportBootstrap(f.b, ["planning"]), ["planning"]);
    assert.equal(
      c.importPacket(f.a.exportPacket(0, ["planning"]), ["planning"]).applied,
      0,
    );
    assert.equal(c.conflicts().length, 0);
    assert.equal(c.get(e.id)!.title, "Latest synthetic title");
    restored = Store.restore(join(f.root, "restored-chain"), c.backup());
    assert.equal(
      restored.importPacket(f.a.exportPacket(0, ["planning"]), ["planning"])
        .applied,
      0,
    );
  } finally {
    restored?.close();
    c?.close();
    f.close();
  }
});
test("restricted create retries recheck visibility without treating generated provenance as a hidden write", () => {
  const f = fixture();
  try {
    const cap: Capability = {
      actor: "synthetic-limited",
      role: "human",
      read: ["planning"],
      write: ["planning"],
      suggest: [],
      scope: {
        planning: {
          fields: ["measure"],
          body: false,
          relations: false,
          metadata: ["title", "occurredAt", "timeZone"],
        },
      },
    };
    const request = {
      entity: input({ fields: { measure: "Permitted" }, body: "" }),
      expectedVersion: 0,
      operationId: "synthetic-retry",
    };
    const first = f.a.save(request, cap),
      again = f.a.save(request, cap);
    assert.equal(again.id, first.id);
    assert.equal(f.a.list().length, 1);
    assert.throws(
      () =>
        f.a.save(request, { ...cap, scope: { planning: { entityIds: [] } } }),
      /Permission/,
    );
  } finally {
    f.close();
  }
});

test("field selection never permits full metadata through baseline or incremental sync, even when all present fields are selected", () => {
  const f = fixture();
  try {
    const e = f.a.save({
      entity: input({ fields: { measure: "shared" } }),
      expectedVersion: 0,
    });
    const scope: SyncScope = {
      modules: ["planning"],
      entities: {
        planning: { fields: ["measure"], body: true, relations: true },
      },
    };
    assert.equal(exportProjection(f.a, scope).records[0].title, "");
    assert.throws(() => exportBootstrap(f.a, scope), /read-only projection/);
    assert.throws(() => f.a.exportPacket(0, scope), /read-only projection/);
    assert.throws(
      () => importBootstrap(f.b, exportBootstrap(f.a, ["planning"]), scope),
      /read-only projection/,
    );
    assert.throws(
      () => f.b.importPacket(f.a.exportPacket(0, ["planning"]), scope),
      /read-only projection/,
    );
    assert.equal(f.b.get(e.id), null);
  } finally {
    f.close();
  }
});

test("malformed projection records and corrupt retained protocol state cannot be imported or published by restore", () => {
  const f = fixture();
  try {
    f.a.save({ entity: input(), expectedVersion: 0 });
    const scope: SyncScope = {
      modules: ["planning"],
      entities: { planning: { fields: ["measure"] } },
    };
    const packet = exportProjection(f.a, scope);
    for (const mutate of [
      (e: Record<string, unknown>) => {
        e.kind = "invented";
      },
      (e: Record<string, unknown>) => {
        e.privateExtension = "hidden data";
      },
      (e: Record<string, unknown>) => {
        e.source = {
          namespace: "redacted",
          recordId: "redacted",
          revision: "redacted",
          mode: "manual",
          hidden: "data",
        };
      },
      (e: Record<string, unknown>) => {
        e.relations = [{ target: packet.records[0].id, type: 42 }];
      },
    ]) {
      const bad = structuredClone(packet);
      mutate(bad.records[0] as unknown as Record<string, unknown>);
      assert.throws(
        () => importProjection(f.b, resign(bad), scope),
        /projection/,
      );
      assert.equal(listProjections(f.b).length, 0);
    }
    importBootstrap(f.b, exportBootstrap(f.a, ["planning"]), ["planning"]);
    importProjection(f.b, packet, scope);
    const original = f.b.backup();
    for (const prefix of [
      "sync-seen:",
      "sync-bootstrap:",
      "sync-projection:",
    ]) {
      const data = JSON.parse(original.payload);
      const row = data.tables.meta.find((r: { key: string }) =>
        r.key.startsWith(prefix),
      );
      assert.ok(row);
      row.value = prefix === "sync-bootstrap:" ? "not-a-checksum" : "{}";
      const payload = JSON.stringify(data),
        target = join(f.root, "invalid-" + prefix.replaceAll(":", ""));
      assert.throws(() =>
        Store.restore(target, { payload, sha256: hash(payload) }),
      );
      assert.equal(
        existsSync(target),
        false,
        "invalid backup must never publish its destination",
      );
    }
    const restored = Store.restore(
      join(f.root, "valid-protocol-state"),
      original,
    );
    try {
      assert.equal(listProjections(restored).length, 1);
      assert.equal(
        restored.importPacket(f.a.exportPacket(0, ["planning"]), ["planning"])
          .applied,
        0,
      );
    } finally {
      restored.close();
    }
  } finally {
    f.close();
  }
});

test("a field write grant cannot silently change record status or delete the record", () => {
  const f = fixture();
  try {
    const e = f.a.save({ entity: input(), expectedVersion: 0 });
    const cap: Capability = {
      actor: "scoped-local-tool",
      role: "human",
      read: ["planning"],
      write: ["planning"],
      suggest: [],
      scope: { planning: { fields: ["measure"] } },
    };
    for (const mutation of [{ status: "done" as const }, { deleted: true }]) {
      assert.throws(
        () =>
          f.a.save(
            {
              entity: { ...e, ...mutation },
              expectedVersion: e.version,
              expectedNoteHash: e.noteHash,
            },
            cap,
          ),
        /Permission denied/,
      );
      assert.equal(f.a.get(e.id)!.version, e.version);
      assert.equal(f.a.get(e.id)!.deleted, false);
    }
    const patched = f.a.patchFields(
      e.id,
      { measure: "permitted update" },
      e.version,
      cap,
    );
    assert.equal(patched.fields.measure, "permitted update");
    const current = f.a.get(e.id)!;
    f.a.save({
      entity: { ...current, deleted: true },
      expectedVersion: current.version,
      expectedNoteHash: current.noteHash,
    });
    assert.equal(
      f.a.get(e.id)!.deleted,
      true,
      "full human authority retains tombstone support",
    );
  } finally {
    f.close();
  }
});
