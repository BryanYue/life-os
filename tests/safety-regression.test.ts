import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { hash } from "../src/vault.js";
import type { EntityInput } from "../src/types.js";
const input = (extra: Partial<EntityInput> = {}): EntityInput => ({
  module: "planning",
  type: "goal",
  title: "Synthetic goal",
  kind: "plan",
  status: "active",
  occurredAt: "2030-01-01",
  timeZone: "UTC",
  fields: {},
  relations: [],
  body: "Synthetic body",
  ...extra,
});
function setup() {
  const root = mkdtempSync("/tmp/life-safety-");
  const a = new Store(join(root, "a"));
  const opened = [a];
  return {
    root,
    a,
    open: (name: string) => {
      const s = new Store(join(root, name));
      opened.push(s);
      return s;
    },
    cleanup: () => {
      for (const s of opened) s.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("new entity cannot overwrite an unrelated user Markdown filename", () => {
  const f = setup();
  try {
    const path = join(f.a.vault.root, "synthetic-id.md");
    writeFileSync(path, "User-owned text without managed frontmatter");
    const e = f.a.save({
      entity: input({ id: "synthetic-id" }),
      expectedVersion: 0,
    });
    assert.equal(
      readFileSync(path, "utf8"),
      "User-owned text without managed frontmatter",
    );
    assert.equal(f.a.get(e.id)!.body, "Synthetic body");
    assert.notEqual(f.a.vault.locate(e.id), path);
  } finally {
    f.cleanup();
  }
});
test("restore rejects missing logical tables rather than returning an empty successful database", () => {
  const f = setup();
  try {
    f.a.save({ entity: input(), expectedVersion: 0 });
    const b = JSON.parse(f.a.backup().payload);
    delete b.tables.entities;
    delete b.tables.edges;
    const payload = JSON.stringify(b),
      dest = join(f.root, "broken");
    assert.throws(
      () => Store.restore(dest, { payload, sha256: hash(payload) }),
      /backup|table/i,
    );
    assert.equal(existsSync(dest), false);
  } finally {
    f.cleanup();
  }
});
test("restore validates all records before publishing destination and allows a corrected retry", () => {
  const f = setup();
  let restored: Store | undefined;
  try {
    const e = f.a.save({ entity: input(), expectedVersion: 0 });
    const good = f.a.backup(),
      bad = JSON.parse(good.payload);
    const row = JSON.parse(bad.tables.entities[0].json);
    row.fields.unrecognized = "must reject";
    bad.tables.entities[0].json = JSON.stringify(row);
    const payload = JSON.stringify(bad),
      dest = join(f.root, "restored");
    assert.throws(
      () => Store.restore(dest, { payload, sha256: hash(payload) }),
      /Invalid fields/,
    );
    assert.equal(existsSync(dest), false);
    restored = Store.restore(dest, good);
    assert.equal(restored.get(e.id)!.title, e.title);
  } finally {
    restored?.close();
    f.cleanup();
  }
});
test("backup restore preserves renamed note paths and rejects note/index mismatch", () => {
  const f = setup();
  let restored: Store | undefined;
  try {
    const e = f.a.save({ entity: input(), expectedVersion: 0 });
    mkdirSync(join(f.a.vault.root, "knowledge"));
    renameSync(
      f.a.vault.locate(e.id)!,
      join(f.a.vault.root, "knowledge", "renamed.md"),
    );
    const good = f.a.backup();
    restored = Store.restore(join(f.root, "ok"), good);
    assert.ok(restored.vault.locate(e.id)!.endsWith("/knowledge/renamed.md"));
    const bad = JSON.parse(good.payload);
    bad.notes[0].markdown += "unindexed edit";
    const payload = JSON.stringify(bad);
    assert.throws(
      () =>
        Store.restore(join(f.root, "bad-index"), {
          payload,
          sha256: hash(payload),
        }),
      /note|index/i,
    );
    assert.equal(existsSync(join(f.root, "bad-index")), false);
  } finally {
    restored?.close();
    f.cleanup();
  }
});
test("source import identities survive sync: retry and next revision keep one stable entity", () => {
  const f = setup();
  try {
    const b = f.open("b");
    const e = input({
      kind: "fact",
      source: {
        namespace: "synthetic-source",
        recordId: "sample-1",
        revision: "r1",
        mode: "import",
      },
    });
    const first = f.a.importSource(e);
    b.importPacket(f.a.exportPacket(0, ["planning"]), ["planning"]);
    assert.equal(b.importSource(e).id, first.id);
    const revised = b.importSource({
      ...e,
      body: "Revised source",
      source: { ...e.source!, revision: "r2" },
    });
    assert.equal(revised.id, first.id);
    assert.equal(b.list().length, 1);
    assert.equal(b.importSource(e).body, "Revised source");
    f.a.importPacket(b.exportPacket(0, ["planning"]), ["planning"]);
    assert.equal(
      f.a.importSource({
        ...e,
        body: "Revised source",
        source: { ...e.source!, revision: "r2" },
      }).id,
      first.id,
    );
    assert.equal(f.a.list().length, 1);
  } finally {
    f.cleanup();
  }
});

test("independent imports use one identity and reject divergent source revisions", () => {
  const f = setup();
  try {
    const b = f.open("b");
    const e = input({
      source: {
        namespace: "synthetic-independent",
        recordId: "one",
        revision: "r1",
        mode: "import",
      },
    });
    const a1 = f.a.importSource(e),
      b1 = b.importSource(e);
    assert.equal(a1.id, b1.id);
    assert.equal(
      b.importPacket(f.a.exportPacket(0, ["planning"]), ["planning"]).applied,
      0,
    );
    const packet = f.a.exportPacket(0, ["planning"]);
    packet.operations[0].value.body = "Different body for same revision";
    packet.operations[0].value.markdown = f.a.vault.compose(
      a1.id,
      a1.module,
      packet.operations[0].value.body,
    );
    packet.sha256 = hash(JSON.stringify({ ...packet, sha256: undefined }));
    assert.throws(
      () => b.importPacket(packet, ["planning"]),
      /different content/,
    );
    assert.equal(b.list().length, 1);
    assert.equal(b.get(b1.id)!.body, e.body);
  } finally {
    f.cleanup();
  }
});

test("source receipts synced by old versions are reconstructed; manual edits do not poison original receipts", () => {
  const f = setup();
  try {
    const e = input({
      source: {
        namespace: "synthetic-legacy",
        recordId: "one",
        revision: "r1",
        mode: "import",
      },
    });
    const a1 = f.a.importSource(e);
    f.a.save({
      entity: { ...a1, body: "Human addition" },
      expectedVersion: a1.version,
      expectedNoteHash: a1.noteHash,
    });
    // v0.1 receivers kept operations but omitted importer indexes.
    f.a.db.exec("DELETE FROM imports; DELETE FROM source_receipts;");
    assert.equal(f.a.importSource(e).body, "Human addition");
    assert.throws(
      () => f.a.importSource({ ...e, body: "Different import" }),
      /revision changed/,
    );
  } finally {
    f.cleanup();
  }
});

test("scoped sync rejects references to excluded modules in both current and historical snapshots", () => {
  const f = setup();
  try {
    const b = f.open("b");
    const hidden = f.a.save({
      entity: input({ module: "learning", type: "goal" }),
      expectedVersion: 0,
    });
    const related = f.a.save({
      entity: input({ relations: [{ type: "related", target: hidden.id }] }),
      expectedVersion: 0,
    });
    const full = f.a.exportPacket(0, ["planning", "learning"]);
    b.importPacket(full, ["planning", "learning"]);
    assert.throws(() => f.a.exportPacket(0, ["planning"]), /relation outside/);
    const filtered = {
      ...full,
      operations: full.operations.filter(
        (op) => op.value.module === "planning",
      ),
    };
    filtered.sha256 = hash(JSON.stringify({ ...filtered, sha256: undefined }));
    assert.throws(
      () => b.importPacket(filtered, ["planning"]),
      /relation outside/,
    );
    f.a.save({
      entity: { ...related, relations: [] },
      expectedVersion: related.version,
      expectedNoteHash: related.noteHash,
    });
    assert.throws(
      () => f.a.exportPacket(full.to, ["planning"]),
      /relation outside/,
    );
  } finally {
    f.cleanup();
  }
});

test("restore rejects traversal, orphan relations and duplicate notes without publishing files", () => {
  const f = setup();
  try {
    f.a.save({ entity: input(), expectedVersion: 0 });
    const backup = f.a.backup();
    for (const change of [
      (b: any) => {
        b.notes[0].relativePath = "../outside.md";
      },
      (b: any) => {
        b.tables.edges.push({
          source: b.notes[0].id,
          target: "missing",
          type: "related",
        });
      },
      (b: any) => {
        b.notes.push(b.notes[0]);
      },
    ]) {
      const bad = JSON.parse(backup.payload);
      change(bad);
      const payload = JSON.stringify(bad),
        dest = join(f.root, "rejected");
      assert.throws(
        () => Store.restore(dest, { payload, sha256: hash(payload) }),
        /backup/i,
      );
      assert.equal(existsSync(dest), false);
    }
    assert.equal(existsSync(join(f.root, "outside.md")), false);
  } finally {
    f.cleanup();
  }
});

test("restore rejects damaged conflict/history/cursor state before publishing and valid conflicts remain resolvable", () => {
  const f = setup();
  let restored: Store | undefined;
  try {
    const e = f.a.save({ entity: input(), expectedVersion: 0 }),
      b = f.open("b");
    b.importPacket(f.a.exportPacket(0, ["planning"]), ["planning"]);
    const other = b.get(e.id)!;
    b.save({
      entity: { ...other, title: "Remote edit" },
      expectedVersion: other.version,
      expectedNoteHash: other.noteHash,
    });
    f.a.save({
      entity: { ...e, title: "Local edit" },
      expectedVersion: e.version,
      expectedNoteHash: e.noteHash,
    });
    f.a.importPacket(b.exportPacket(0, ["planning"]), ["planning"]);
    assert.equal(f.a.conflicts().length, 1);
    const good = f.a.backup();
    for (const change of [
      (x: any) => {
        x.tables.conflicts[0].json = "not-json";
      },
      (x: any) => {
        x.tables.cursors[0].seq = "not-a-sequence";
      },
      (x: any) => {
        const op = JSON.parse(x.tables.operations[0].json);
        op.value.source = null;
        x.tables.operations[0].json = JSON.stringify(op);
      },
      (x: any) => {
        x.tables.imports.push({
          namespace: "sample",
          source_id: "one",
          revision: "1",
          entity: e.id,
          digest: "bad",
        });
      },
    ]) {
      const bad = JSON.parse(good.payload);
      change(bad);
      const payload = JSON.stringify(bad),
        dest = join(f.root, "bad-state");
      assert.throws(() =>
        Store.restore(dest, { payload, sha256: hash(payload) }),
      );
      assert.equal(existsSync(dest), false);
    }
    restored = Store.restore(join(f.root, "good-state"), good);
    const c = restored.conflicts()[0];
    assert.equal(
      restored.resolveConflict(c.id, "incoming", restored.get(e.id)!.version)
        .title,
      "Remote edit",
    );
  } finally {
    restored?.close();
    f.cleanup();
  }
});
