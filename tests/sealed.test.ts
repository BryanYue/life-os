import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  symlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createKeyFile, readKeyFile, seal, unseal } from "../src/sealed.js";
import { outsideRepository, projectRoot } from "../src/paths.js";
import { Store } from "../src/store.js";
import type { SyncPacket } from "../src/types.js";

test("encrypted envelopes roundtrip backups and sync without plaintext; replay remains idempotent", () => {
  const root = mkdtempSync(join(tmpdir(), "life-sealed-"));
  const a = new Store(join(root, "a")),
    b = new Store(join(root, "b"));
  let restored: Store | undefined;
  try {
    const e = a.save({
      entity: {
        module: "planning",
        type: "goal",
        title: "Synthetic encrypted note",
        kind: "plan",
        status: "active",
        occurredAt: "2030-01-01",
        timeZone: "UTC",
        fields: {},
        relations: [],
        body: "合成私密正文 for envelope tests",
      },
      expectedVersion: 0,
    });
    const key = randomBytes(32),
      backup = a.backup();
    const encrypted = seal(backup, "backup", key);
    assert.equal(JSON.stringify(encrypted).includes(e.body), false);
    assert.notEqual(
      seal(backup, "backup", key).ciphertext,
      encrypted.ciphertext,
    );
    restored = Store.restore(
      join(root, "restored"),
      unseal(encrypted, "backup", key),
    );
    assert.equal(restored.get(e.id)!.body, e.body);
    const packet = unseal<SyncPacket>(
      seal(a.exportPacket(0, ["planning"]), "sync", key),
      "sync",
      key,
    );
    assert.equal(b.importPacket(packet, ["planning"]).applied, 1);
    assert.equal(b.importPacket(packet, ["planning"]).applied, 0);
    assert.equal(b.get(e.id)!.body, e.body);
  } finally {
    restored?.close();
    a.close();
    b.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("encrypted envelopes fail closed for tamper, wrong key, purpose and unsupported versions", () => {
  const key = randomBytes(32),
    envelope = seal({ value: "synthetic" }, "backup", key);
  assert.throws(
    () => unseal(envelope, "backup", randomBytes(32)),
    /authentication/,
  );
  assert.throws(() => unseal(envelope, "sync", key), /purpose/);
  assert.throws(
    () => unseal({ ...envelope, version: 2 }, "backup", key),
    /Unsupported/,
  );
  for (const field of ["ciphertext", "tag", "nonce"] as const) {
    const bytes = Buffer.from(envelope[field], "base64");
    bytes[0] ^= 1;
    assert.throws(
      () =>
        unseal(
          { ...envelope, [field]: bytes.toString("base64") },
          "backup",
          key,
        ),
      /authentication/,
    );
  }
  assert.throws(
    () => unseal({ ...envelope, purpose: "sync" }, "sync", key),
    /authentication/,
  );
  assert.throws(
    () => unseal({ ...envelope, nonce: "not base64" }, "backup", key),
    /Invalid/,
  );
});

test("private key files and data paths reject overwrite, loose permissions, symlinks and repository ancestors", () => {
  const root = mkdtempSync(join(tmpdir(), "life-key-")),
    path = join(root, "key");
  try {
    createKeyFile(path);
    assert.equal(readKeyFile(path).length, 32);
    assert.throws(() => createKeyFile(path), /EEXIST/);
    chmodSync(path, 0o644);
    assert.throws(() => readKeyFile(path), /private 32-byte/);
    chmodSync(path, 0o600);
    symlinkSync(path, join(root, "key-link"));
    assert.throws(() => readKeyFile(join(root, "key-link")));
    assert.throws(
      () => outsideRepository(join(projectRoot, "new-private-directory")),
      /outside/,
    );
    symlinkSync(projectRoot, join(root, "repo-link"));
    assert.throws(
      () => outsideRepository(join(root, "repo-link", "new-dir", "data")),
      /outside/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI encrypted backup/restore works from another working directory and rejects a wrong key before publishing", () => {
  const root = mkdtempSync(join(tmpdir(), "life-cli-sealed-"));
  const home = join(root, "data"),
    key = join(root, "key"),
    backup = join(root, "backup.json");
  const cli = (args: string[], keyPath = key) =>
    spawnSync(
      process.execPath,
      [
        "--import",
        join(projectRoot, "node_modules/tsx/dist/loader.mjs"),
        join(projectRoot, "src/cli.ts"),
        ...args,
      ],
      {
        cwd: root,
        env: { ...process.env, LIFE_OS_HOME: home, LIFE_OS_KEY_FILE: keyPath },
        encoding: "utf8",
      },
    );
  try {
    for (const args of [
      ["keygen", key],
      ["demo"],
      ["backup-encrypted", backup],
      ["restore-encrypted", backup, join(root, "restored")],
    ]) {
      const result = cli(args);
      assert.equal(result.status, 0, result.stderr);
    }
    assert.equal(
      JSON.parse(readFileSync(backup, "utf8")).format,
      "life-os-sealed",
    );
    const restored = new Store(join(root, "restored"));
    try {
      assert.equal(restored.list().length, 16);
    } finally {
      restored.close();
    }
    const otherKey = join(root, "other-key");
    createKeyFile(otherKey);
    assert.notEqual(
      cli(["restore-encrypted", backup, join(root, "wrong")], otherKey).status,
      0,
    );
    assert.equal(existsSync(join(root, "wrong")), false);
    assert.notEqual(
      cli(["backup", join(projectRoot, "forbidden-backup.json")]).status,
      0,
    );
    assert.equal(existsSync(join(projectRoot, "forbidden-backup.json")), false);
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({ syncModules: ["planning"] }),
    );
    const packet = join(root, "sync.json");
    assert.equal(cli(["export-sync-encrypted", packet, "0"]).status, 0);
    assert.equal(cli(["import-sync-encrypted", packet]).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
