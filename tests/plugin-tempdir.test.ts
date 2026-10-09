import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import { Store } from "../src/store.js";
import { PluginManager } from "../src/plugins.js";
import { projectRoot } from "../src/paths.js";

test("plugin tempdir alias runs with exact-file permissions and cleans up on success/failure", async () => {
  const root = mkdtempSync("/tmp/life-plugin-alias-test-");
  const previous = process.env.TMPDIR;
  const store = new Store(join(root, "data"));
  const server = createServer((_req, res) => res.end("synthetic"));
  try {
    mkdirSync(join(root, "real"));
    symlinkSync(join(root, "real"), join(root, "alias"));
    cpSync(join(projectRoot, "examples/plugin-plants"), join(root, "code"), {
      recursive: true,
    });
    const manager = new PluginManager(store, {
      repositoryRoot: projectRoot,
      timeoutMs: 500,
    });
    manager.install(join(root, "code/manifest.json"));
    manager.authorize("demo.plugin-plants", {
      trustLocalCode: true,
      acknowledgeUnsandboxedNetwork: true,
    });
    manager.enable("demo.plugin-plants");
    process.env.TMPDIR = join(root, "alias");
    assert.deepEqual(await manager.invoke("demo.plugin-plants", "summarize"), {
      count: 0,
      waterMl: 0,
    });
    const secretPath = join(root, "synthetic-private.txt");
    writeFileSync(secretPath, "synthetic only");
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const result = await manager.invoke("demo.plugin-plants", "runtime-probe", {
      secretPath,
      loopbackUrl: `http://127.0.0.1:${address.port}`,
    });
    assert.deepEqual(result, {
      filesystemReadDenied: true,
      filesystemWriteDenied: true,
      childProcessDenied: true,
      workerDenied: true,
      environmentCleared: true,
      directNetworkAllowed: true,
    });
    await assert.rejects(
      manager.invoke("demo.plugin-plants", "runtime-probe", { hang: true }),
      /timed out/,
    );
    assert.deepEqual(readdirSync(join(root, "real")), []);
  } finally {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
