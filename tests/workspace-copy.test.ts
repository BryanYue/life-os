import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { test } from "node:test";
import {
  assertRunnableWorkspace,
  prepareWorkspaceCopy,
  WORKSPACE_COPY_MARKER,
  type WorkspaceCopyOptions,
} from "../src/workspace-copy.js";
import { Store } from "../src/store.js";
import { hash } from "../src/vault.js";
import { projectRoot } from "../src/paths.js";

test("private workspace preservation cannot publish inside the public repository", async () => {
  const f = fixture();
  try {
    writeFileSync(
      join(f.source, "unknown-note.md"),
      "Synthetic preserved text",
    );
    const target = join(projectRoot, "private-copy-denied");
    assert.equal(existsSync(target), false);
    await assert.rejects(
      prepareWorkspaceCopy(f.source, target, { offlineConfirmed: true }),
    );
    assert.equal(existsSync(target), false);
    assertNoStaging(projectRoot);
    assert.equal(
      readFileSync(join(f.source, "unknown-note.md"), "utf8"),
      "Synthetic preserved text",
    );
  } finally {
    f.close();
  }
});

function fixture() {
  // Canonicalize only the fixture root; deliberate symlink inputs remain rejected.
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "life-workspace-copy-test-")),
  );
  const source = join(root, "source"),
    target = join(root, "target");
  mkdirSync(source);
  return {
    root,
    source,
    target,
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}
function tree(root: string) {
  const files: Record<string, string> = {},
    metadata: Record<string, string> = {};
  function visit(part: string) {
    const path = join(root, part),
      stat = lstatSync(path, { bigint: true });
    metadata[part] = [
      stat.dev,
      stat.ino,
      stat.mode,
      stat.size,
      stat.mtimeNs,
      stat.ctimeNs,
    ].join(":");
    if (stat.isDirectory())
      for (const name of readdirSync(path).sort()) visit(join(part, name));
    else files[part] = readFileSync(path).toString("hex");
  }
  visit("");
  return { files, metadata };
}
function assertNoStaging(root: string) {
  assert.equal(
    readdirSync(root).some((name) => name.startsWith(".life-preserve-")),
    false,
  );
}
async function waitForStaging(root: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (readdirSync(root).some((name) => name.startsWith(".life-preserve-")))
      return;
    await nextTurn();
  }
  assert.fail("Synthetic preservation did not enter staging");
}

test("offline preservation retains unknown bytes, notes, personal configuration and private module files without executing them", async () => {
  const f = fixture();
  try {
    for (const part of [
      "vault/unregistered",
      "attachments",
      "private-module",
      "empty",
    ])
      mkdirSync(join(f.source, part), { recursive: true });
    const samples: Record<string, Buffer | string> = {
      "life.sqlite": Buffer.from([0, 255, 128, 1, 0]),
      "life.sqlite-wal": Buffer.alloc(0),
      "attachments/custom.bin": Buffer.from([255, 0, 16, 24, 17]),
      "vault/unregistered/personal.md":
        "---\nunknown: kept\n---\nA fictional unregistered note.\n",
      "personal-config.json":
        '{"fictionalAccount":"sample-only","customMode":true}',
      "private-module/manifest.json": '{"customUnknownManifest":true}',
      "private-module/run.js": "throw new Error('must never execute');\n",
      "plugin-state.json":
        '{"authorized":true,"opaqueLegacyConfiguration":true}',
      // The source may already own any chosen metadata filename.
      [WORKSPACE_COPY_MARKER]: "opaque preexisting source file",
    };
    for (const [part, value] of Object.entries(samples))
      writeFileSync(join(f.source, part), value);
    const before = tree(f.source);
    const result = await prepareWorkspaceCopy(f.source, f.target, {
      offlineConfirmed: true,
    });
    assert.equal(result.kind, "preservation-only");
    assert.equal(result.runnable, false);
    assert.equal(
      result.pluginAuthorization,
      "archived-requires-fresh-authorization",
    );
    assert.equal(result.fileCount, Object.keys(samples).length);
    assert.equal(
      result.totalBytes,
      String(
        Object.values(samples).reduce(
          (sum, data) => sum + Buffer.byteLength(data),
          0,
        ),
      ),
    );
    assert.deepEqual(tree(result.archiveDirectory).files, before.files);
    assert.deepEqual(tree(f.source), before);
    assert.equal(existsSync(join(result.archiveDirectory, "empty")), true);
    assert.equal(existsSync(join(f.target, "life.sqlite")), false);
    assert.equal(existsSync(join(f.target, "plugin-state.json")), false);
    for (const part of [
      "",
      "archive",
      "archive/empty",
      "archive/vault",
      "archive/private-module",
    ])
      assert.equal(lstatSync(join(f.target, part)).mode & 0o777, 0o700);
    for (const part of Object.keys(samples))
      assert.equal(
        lstatSync(join(result.archiveDirectory, part)).mode & 0o777,
        0o600,
      );
    assert.equal(
      lstatSync(join(f.target, WORKSPACE_COPY_MARKER)).mode & 0o777,
      0o600,
    );
    const marker = JSON.parse(
      readFileSync(join(f.target, WORKSPACE_COPY_MARKER), "utf8"),
    );
    assert.equal(marker.runnable, false);
    assert.equal(marker.archiveDirectory, "archive");
    assert.throws(() => assertRunnableWorkspace(f.target), /preservation-only/);
    assert.throws(
      () => assertRunnableWorkspace(result.archiveDirectory),
      /preservation-only|marker is invalid|could not be verified/,
    );
    assert.throws(
      () => assertRunnableWorkspace(join(result.archiveDirectory, "vault")),
      /preservation-only|marker is invalid|could not be verified/,
    );
    assertNoStaging(f.root);
  } finally {
    f.close();
  }
});

test("confirmation is mandatory and preservation reads a filesystem-readonly source", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.source, "unknown.dat"), "fictional bytes");
    await assert.rejects(
      prepareWorkspaceCopy(f.source, f.target, {} as WorkspaceCopyOptions),
      /all source writers are stopped/,
    );
    assert.equal(existsSync(f.target), false);
    chmodSync(join(f.source, "unknown.dat"), 0o400);
    chmodSync(f.source, 0o500);
    const before = tree(f.source);
    await prepareWorkspaceCopy(f.source, f.target, { offlineConfirmed: true });
    assert.deepEqual(tree(f.source), before);
  } finally {
    chmodSync(f.source, 0o700);
    f.close();
  }
});

test("overlapping paths, existing destinations and symbolic links are rejected without changing either tree", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.source, "note"), "fictional data");
    mkdirSync(f.target);
    writeFileSync(join(f.target, "sentinel"), "untouched");
    const before = tree(f.source),
      destination = tree(f.target);
    await assert.rejects(
      prepareWorkspaceCopy(f.source, f.target, { offlineConfirmed: true }),
      /new destination/,
    );
    assert.deepEqual(tree(f.target), destination);
    for (const target of [f.source, join(f.source, "nested"), f.root])
      await assert.rejects(
        prepareWorkspaceCopy(f.source, target, { offlineConfirmed: true }),
        /overlap/,
      );
    symlinkSync(f.source, join(f.root, "source-alias"));
    await assert.rejects(
      prepareWorkspaceCopy(
        join(f.root, "source-alias"),
        join(f.root, "alias-copy"),
        { offlineConfirmed: true },
      ),
      /symbolic links/,
    );
    symlinkSync(f.root, join(f.root, "parent-alias"));
    await assert.rejects(
      prepareWorkspaceCopy(
        f.source,
        join(f.root, "parent-alias", "alias-copy"),
        { offlineConfirmed: true },
      ),
      /symbolic links/,
    );
    symlinkSync(join(f.root, "missing"), join(f.root, "dangling-target"));
    await assert.rejects(
      prepareWorkspaceCopy(f.source, join(f.root, "dangling-target"), {
        offlineConfirmed: true,
      }),
      /new destination/,
    );
    assert.deepEqual(tree(f.source), before);
    symlinkSync(join(f.source, "note"), join(f.source, "unsafe-link"));
    await assert.rejects(
      prepareWorkspaceCopy(f.source, join(f.root, "file-link-copy"), {
        offlineConfirmed: true,
      }),
      /symbolic link or special file/,
    );
    assert.equal(existsSync(join(f.root, "file-link-copy")), false);
    assertNoStaging(f.root);
  } finally {
    f.close();
  }
});

test("nonempty WAL and FIFO are refused without publishing incomplete data", async () => {
  const f = fixture();
  try {
    writeFileSync(
      join(f.source, "life.sqlite-wal"),
      "synthetic uncheckpointed WAL",
    );
    await assert.rejects(
      prepareWorkspaceCopy(f.source, f.target, { offlineConfirmed: true }),
      /nonempty WAL.*stop services/,
    );
    assert.equal(existsSync(f.target), false);
    rmSync(join(f.source, "life.sqlite-wal"));
    const fifo = spawnSync("mkfifo", [join(f.source, "unsupported-fifo")]);
    assert.equal(fifo.status, 0);
    await assert.rejects(
      prepareWorkspaceCopy(f.source, f.target, { offlineConfirmed: true }),
      /symbolic link or special file/,
    );
    assert.equal(existsSync(f.target), false);
    assertNoStaging(f.root);
  } finally {
    f.close();
  }
});

test("abort during staging and a concurrently created target never overwrite a destination", async () => {
  const f = fixture();
  try {
    writeFileSync(
      join(f.source, "synthetic-large.bin"),
      Buffer.alloc(8 * 1024 * 1024, 47),
    );
    const before = tree(f.source),
      controller = new AbortController();
    const pending = prepareWorkspaceCopy(f.source, f.target, {
      offlineConfirmed: true,
      signal: controller.signal,
    });
    const rejection = assert.rejects(pending, /interrupted/);
    await waitForStaging(f.root);
    controller.abort();
    await rejection;
    assert.equal(existsSync(f.target), false);
    assertNoStaging(f.root);
    assert.deepEqual(tree(f.source), before);
    const race = prepareWorkspaceCopy(f.source, f.target, {
      offlineConfirmed: true,
    });
    const raceRejection = assert.rejects(race, /failed|new destination/);
    await waitForStaging(f.root);
    mkdirSync(f.target);
    writeFileSync(join(f.target, "created-by-other-writer"), "never replace");
    await raceRejection;
    assert.deepEqual(readdirSync(f.target), ["created-by-other-writer"]);
    assert.equal(
      readFileSync(join(f.target, "created-by-other-writer"), "utf8"),
      "never replace",
    );
    assert.deepEqual(tree(f.source), before);
    assertNoStaging(f.root);
  } finally {
    f.close();
  }
});

test("source edits observed during copying invalidate the result and remove staging", async () => {
  const f = fixture();
  try {
    writeFileSync(
      join(f.source, "synthetic-large.bin"),
      Buffer.alloc(8 * 1024 * 1024, 64),
    );
    const pending = prepareWorkspaceCopy(f.source, f.target, {
      offlineConfirmed: true,
    });
    const rejection = assert.rejects(pending, /changed during preservation/);
    await waitForStaging(f.root);
    writeFileSync(
      join(f.source, "new-unregistered-note.md"),
      "Synthetic concurrent edit",
    );
    await rejection;
    assert.equal(existsSync(f.target), false);
    assertNoStaging(f.root);
  } finally {
    f.close();
  }
});

test("startup guard permits ordinary data and fails closed for unreadable or symlinked markers", () => {
  const f = fixture();
  try {
    assert.doesNotThrow(() => assertRunnableWorkspace(f.source));
    writeFileSync(join(f.source, WORKSPACE_COPY_MARKER), "invalid JSON");
    assert.throws(
      () => assertRunnableWorkspace(f.source),
      /direct startup denied/,
    );
    rmSync(join(f.source, WORKSPACE_COPY_MARKER));
    symlinkSync(join(f.root, "missing"), join(f.source, WORKSPACE_COPY_MARKER));
    assert.throws(
      () => assertRunnableWorkspace(f.source),
      /direct startup denied/,
    );
  } finally {
    f.close();
  }
});

test("legacy logical backups remain separately restorable with a new device while the complete archive keeps unknown files", async () => {
  const f = fixture();
  let source: Store | undefined, restored: Store | undefined;
  try {
    source = new Store(f.source);
    const entity = source.save({
      entity: {
        module: "planning",
        type: "goal",
        title: "Fictional legacy goal",
        kind: "plan",
        status: "active",
        occurredAt: "2030-04-01",
        timeZone: "UTC",
        fields: {},
        relations: [],
        body: "Fictional legacy body\n",
      },
      expectedVersion: 0,
    });
    const device = source.device,
      backup = source.backup();
    const oldFormat = JSON.parse(backup.payload);
    for (const note of oldFormat.notes) delete note.relativePath;
    const payload = JSON.stringify(oldFormat);
    source.close();
    source = undefined;
    mkdirSync(join(f.source, "private-module"));
    writeFileSync(
      join(f.source, "private-module", "opaque.json"),
      '{"syntheticUnknown":true}',
    );
    writeFileSync(
      join(f.source, "vault", "unregistered.md"),
      "Fictional unregistered note\n",
    );
    const before = tree(f.source);
    const result = await prepareWorkspaceCopy(f.source, f.target, {
      offlineConfirmed: true,
    });
    restored = Store.restore(join(f.root, "separate-reviewed-restore"), {
      payload,
      sha256: hash(payload),
    });
    assert.equal(restored.get(entity.id)?.body, entity.body);
    assert.notEqual(restored.device, device);
    assert.equal(
      restored.db
        .prepare("SELECT value FROM meta WHERE key='restored_isolated'")
        .get()?.value,
      "true",
    );
    assert.deepEqual(tree(result.archiveDirectory).files, before.files);
    assert.deepEqual(tree(f.source), before);
    assert.throws(
      () => assertRunnableWorkspace(result.archiveDirectory),
      /preservation-only/,
    );
  } finally {
    source?.close();
    restored?.close();
    f.close();
  }
});
