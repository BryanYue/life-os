import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  renameSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/store.js";
import { app } from "../src/server.js";
import { obsidianNote, obsidianVault } from "../src/obsidian.js";
import { HUMAN } from "../src/types.js";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "life-obsidian-"));
  const store = new Store(root);
  const entity = store.save({
    expectedVersion: 0,
    entity: {
      module: "learning",
      type: "note",
      title: "Synthetic note",
      kind: "fact",
      status: "done",
      occurredAt: "2030-04-01",
      timeZone: "UTC",
      fields: { topic: "synthetic" },
      relations: [],
      body: "Original synthetic text",
    },
  });
  return {
    store,
    root,
    entity,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("Obsidian identity opens only a managed note, preserves external text/frontmatter and follows moves", () => {
  const f = fixture();
  try {
    const before = f.store.db
      .prepare("SELECT COUNT(*) n FROM operations")
      .get()!.n;
    assert.equal(obsidianVault(f.store).registration, "unknown");
    const old = f.store.vault.read(f.entity.id)!;
    const moved = join(f.store.vault.root, "合成 & 文件夹");
    mkdirSync(moved);
    const path = join(moved, "renamed note?.md");
    renameSync(old.path, path);
    writeFileSync(
      path,
      readFileSync(path, "utf8")
        .replace("---\n", "---\nkeep_custom: untouched\n")
        .replace("Original synthetic text", "External synthetic edit"),
    );
    const link = obsidianNote(f.store, f.entity.id);
    assert.equal(decodeURIComponent(link.openUri.split("?path=")[1]), path);
    assert.equal(new URL(link.openUri).searchParams.size, 1);
    assert.equal(link.relativePath, "合成 & 文件夹/renamed note?.md");
    assert.equal(f.store.get(f.entity.id)!.body, "External synthetic edit");
    assert.equal(
      f.store.db.prepare("SELECT COUNT(*) n FROM operations").get()!.n,
      before,
    );
    assert.throws(
      () =>
        f.store.save({
          entity: { ...f.entity, body: "stale overwrite" },
          expectedVersion: f.entity.version,
          expectedNoteHash: f.entity.noteHash,
        }),
      /changed externally/,
    );
    assert.match(readFileSync(path, "utf8"), /External synthetic edit/);
    const fresh = f.store.get(f.entity.id)!;
    f.store.save({
      entity: { ...fresh, body: "Reviewed synthetic correction" },
      expectedVersion: fresh.version,
      expectedNoteHash: fresh.noteHash,
    });
    assert.match(readFileSync(path, "utf8"), /keep_custom: untouched/);
    assert.match(readFileSync(path, "utf8"), /Reviewed synthetic correction/);
    assert.equal(f.store.vault.read(f.entity.id)!.path, path);
  } finally {
    f.close();
  }
});
test("Obsidian rejects deleted, missing, duplicate, identity-changed and symlink notes", () => {
  const f = fixture();
  try {
    const note = f.store.vault.read(f.entity.id)!;
    const duplicate = join(f.store.vault.root, "duplicate.md");
    writeFileSync(duplicate, note.markdown);
    assert.throws(() => obsidianNote(f.store, f.entity.id), /Duplicate/);
    rmSync(duplicate);
    writeFileSync(
      note.path,
      note.markdown.replace("life_module: learning", "life_module: planning"),
    );
    assert.throws(() => obsidianNote(f.store, f.entity.id), /identity changed/);
    writeFileSync(note.path, note.markdown);
    const outside = join(f.root, "synthetic-outside.md");
    writeFileSync(outside, note.markdown);
    rmSync(note.path);
    symlinkSync(outside, note.path);
    assert.throws(() => obsidianNote(f.store, f.entity.id), /symlink/);
    rmSync(note.path);
    assert.throws(() => obsidianNote(f.store, f.entity.id), /missing/);
    writeFileSync(note.path, note.markdown);
    f.store.save({
      entity: { ...f.entity, deleted: true },
      expectedVersion: f.entity.version,
      expectedNoteHash: f.entity.noteHash,
    });
    assert.throws(() => obsidianNote(f.store, f.entity.id), /unavailable/);
    assert.throws(() => obsidianNote(f.store, "unknown"), /unavailable/);
    assert.throws(
      () => obsidianNote(f.store, "../synthetic-outside"),
      /unavailable|Invalid/,
    );
    assert.throws(
      () =>
        obsidianNote(f.store, f.entity.id, {
          ...HUMAN,
          scope: { learning: { body: false } },
        }),
      /Permission/,
    );
    assert.throws(
      () => obsidianVault(f.store, { ...HUMAN, role: "ai" }),
      /Permission/,
    );
  } finally {
    f.close();
  }
});
test("Obsidian HTTP endpoints require a human local session and perform no write or launch", async () => {
  const f = fixture();
  const server = app(f.store, {
    agentToken: "synthetic-test-token",
    agentModules: ["learning"],
  });
  const host = { host: "127.0.0.1:4310" };
  try {
    for (const url of [
      "/api/obsidian/vault",
      "/api/obsidian/notes/" + f.entity.id,
    ]) {
      assert.equal(
        (await server.inject({ url, headers: host })).statusCode,
        401,
      );
      assert.equal(
        (
          await server.inject({
            url,
            headers: { ...host, authorization: "Bearer synthetic-test-token" },
          })
        ).statusCode,
        403,
      );
    }
    const session = await server.inject({ url: "/api/session", headers: host });
    const headers = {
      ...host,
      cookie: String(session.headers["set-cookie"]).split(";")[0],
    };
    const before = f.store.audit().length;
    const info = await server.inject({ url: "/api/obsidian/vault", headers });
    assert.equal(info.statusCode, 200);
    assert.equal(info.json().vaultPath, f.store.vault.root);
    const link = await server.inject({
      url: "/api/obsidian/notes/" + f.entity.id,
      headers,
    });
    assert.equal(link.statusCode, 200);
    assert.match(link.json().openUri, /^obsidian:\/\/open\?path=/);
    assert.equal(
      (
        await server.inject({
          url: "/api/obsidian/vault",
          headers: { ...headers, origin: "https://attacker.invalid" },
        })
      ).statusCode,
      403,
    );
    assert.equal(f.store.audit().length, before);
  } finally {
    await server.close();
    f.close();
  }
});
