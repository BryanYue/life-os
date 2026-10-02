import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../src/store.js";
import { validateContract } from "../src/module-contract.js";
import { PluginManager } from "../src/plugins.js";
import type { PluginManifest } from "../src/plugins.js";
import type { EntityInput } from "../src/types.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sample = join(repositoryRoot, "examples/plugin-plants");
const pluginId = "demo.plugin-plants";
function fixture(
  options: { timeoutMs?: number; maxOutputBytes?: number } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "life-plugin-test-"));
  cpSync(sample, join(root, "code"), { recursive: true });
  const store = new Store(join(root, "data"));
  const manager = new PluginManager(store, { repositoryRoot, ...options });
  const path = join(root, "code", "manifest.json");
  const manifest = () =>
    JSON.parse(readFileSync(path, "utf8")) as PluginManifest;
  const write = (value: PluginManifest) =>
    writeFileSync(path, JSON.stringify(value));
  const close = () => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  };
  return { root, store, manager, path, manifest, write, close };
}
const input = (patch: Partial<EntityInput> = {}): EntityInput => ({
  module: pluginId,
  type: "plant",
  title: "Fictional fern",
  kind: "inference",
  status: "draft",
  occurredAt: "2030-04-01",
  timeZone: "UTC",
  fields: { nickname: "Fictional fern", waterMl: 30 },
  relations: [],
  body: "Synthetic fixture only",
  ...patch,
});
const request = (patch: Partial<EntityInput> = {}) => ({
  entity: input(patch),
  expectedVersion: 0,
});
function trusted(f: ReturnType<typeof fixture>, permissions?: string[]) {
  f.manager.install(f.path);
  f.manager.authorize(pluginId, {
    ...(permissions ? { permissions } : {}),
    trustLocalCode: true,
    acknowledgeUnsandboxedNetwork: true,
  });
  f.manager.enable(pluginId);
}

test("module contracts validate core ranges, operations, dependencies, importers and schema scopes", () => {
  const f = fixture();
  try {
    validateContract(f.manifest().module);
    for (const change of [
      (m: PluginManifest) => {
        m.module.contract.core.minVersion = "0.2.0";
      },
      (m: PluginManifest) => {
        m.module.contract.permissions[0].module = "planning";
      },
      (m: PluginManifest) => {
        m.module.contract.permissions[0].fields = ["missing"];
      },
      (m: PluginManifest) => {
        m.module.contract.operations[0].permissions = ["unknown"];
      },
      (m: PluginManifest) => {
        m.module.contract.operations[0].handler = "write";
      },
      (m: PluginManifest) => {
        m.module.contract.importers[0].operation = "list";
      },
      (m: PluginManifest) => {
        m.module.contract.dependencies = [
          { module: pluginId, minVersion: "1.0.0" },
        ];
      },
    ]) {
      const value = f.manifest();
      change(value);
      assert.throws(() => validateContract(value.module));
    }
  } finally {
    f.close();
  }
});

test("declarative plugin lifecycle persists grants, runs importers, keeps data and requires explicit authorization", async () => {
  const f = fixture();
  try {
    assert.throws(
      () => f.manager.install(join(sample, "manifest.json")),
      /outside repository/,
    );
    const installed = f.manager.install(f.path);
    assert.equal(installed.state, "installed");
    assert.throws(() => f.manager.enable(pluginId), /authorization/);
    f.manager.authorize(pluginId);
    f.manager.enable(pluginId);
    const imported = (await f.manager.import(
      pluginId,
      "draft-json",
      JSON.stringify(request()),
    )) as { id: string; pending: boolean };
    assert.equal(imported.pending, false);
    assert.ok(
      f.store.get(imported.id),
      "completed importer result reflects a committed entity",
    );
    const rows = (await f.manager.invoke(pluginId, "list")) as any[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "inference");
    assert.equal(rows[0].status, "draft");
    await assert.rejects(
      f.manager.invoke(
        pluginId,
        "write",
        request({ kind: "fact", status: "active" }),
      ),
      /permission denied/,
    );
    await assert.rejects(
      f.manager.invoke(pluginId, "suggest", request({ kind: "fact" })),
      /draft inferences/,
    );
    await assert.rejects(
      f.manager.import(
        pluginId,
        "draft-json",
        JSON.stringify({ install: "/tmp/other-plugin.json", command: "spawn" }),
      ),
      /permission denied/,
    );
    const restoredManager = new PluginManager(f.store, { repositoryRoot });
    assert.equal(
      restoredManager.list()[0].grants.includes("write-plants"),
      false,
    );
    restoredManager.disable(pluginId);
    await assert.rejects(restoredManager.invoke(pluginId, "list"), /disabled/);
    restoredManager.uninstall(pluginId);
    assert.equal(f.store.list({ module: pluginId }).length, 1);
    const next = restoredManager.install(f.path);
    assert.equal(next.authorized, false);
    assert.throws(() => restoredManager.enable(pluginId), /authorization/);
  } finally {
    f.close();
  }
});

test("broker limits reads to types and fields and denies unauthorized writes, cross module access and external execution", async () => {
  const f = fixture();
  try {
    trusted(f);
    f.store.save(
      request({
        kind: "fact",
        status: "active",
        fields: {
          nickname: "Fictional fern",
          waterMl: 30,
          privateNote: "Synthetic hidden",
        },
      }),
    );
    const rows = (await f.manager.invoke(pluginId, "list")) as any[];
    assert.deepEqual(rows[0].fields, {
      nickname: "Fictional fern",
      waterMl: 30,
    });
    assert.equal("body" in rows[0], false);
    assert.equal("noteHash" in rows[0], false);
    assert.equal("relations" in rows[0], false);
    assert.deepEqual(await f.manager.invoke(pluginId, "summarize"), {
      count: 1,
      waterMl: 30,
    });
    await assert.rejects(
      f.manager.invoke(pluginId, "broker-probe", {
        permission: "write-plants",
        action: "save",
        request: request({ kind: "fact", status: "active" }),
      }),
      /permission denied/,
    );
    await assert.rejects(
      f.manager.invoke(
        pluginId,
        "propose",
        request({
          fields: { nickname: "Fictional", privateNote: "Forbidden" },
        }),
      ),
      /field permission denied/,
    );
    await assert.rejects(
      f.manager.invoke(
        pluginId,
        "propose",
        request({ module: "planning", type: "goal" }),
      ),
      /permission denied/,
    );
    await assert.rejects(
      f.manager.invoke(pluginId, "broker-probe", {
        permission: "undeclared-planning",
        action: "list",
      }),
      /permission denied/,
    );
    f.manager.authorize(pluginId, {
      permissions: [
        "read-plants",
        "suggest-plants",
        "write-plants",
        "external-plants",
      ],
      trustLocalCode: true,
      acknowledgeUnsandboxedNetwork: true,
    });
    f.manager.enable(pluginId);
    await assert.rejects(
      f.manager.invoke(pluginId, "external"),
      /External execution disabled/,
    );
    await assert.rejects(
      f.manager.invoke(pluginId, "broker-probe", {
        permission: "external-plants",
        action: "external",
      }),
      /External execution disabled/,
    );
    await f.manager.invoke(
      pluginId,
      "write",
      request({ kind: "fact", status: "active" }),
    );
    assert.equal(f.store.list({ module: pluginId }).length, 2);
    const existing = f.store
      .list({ module: pluginId })
      .find((entity) => entity.fields.privateNote)!;
    await assert.rejects(
      f.manager.invoke(pluginId, "write", {
        entity: { ...existing, fields: { nickname: "Changed" } },
        expectedVersion: existing.version,
        expectedNoteHash: existing.noteHash,
      }),
      /field scope/,
    );
  } finally {
    f.close();
  }
});

test("private and public manifests share dependencies, missing versions fail visibly and enabled dependents block disable", () => {
  const f = fixture();
  try {
    const value = f.manifest();
    value.module.codeVisibility = "private";
    value.module.contract.dependencies = [
      { module: "planning", minVersion: "9.0.0" },
    ];
    f.write(value);
    assert.throws(() => f.manager.install(f.path), /dependency/);
    assert.equal(f.manager.list()[0].events.at(-1)?.ok, false);
    assert.equal(
      f.store.modules().some((m) => m.id === pluginId),
      false,
    );
    value.module.contract.dependencies[0].minVersion = "0.1.0";
    f.write(value);
    f.manager.install(f.path);
    f.manager.authorize(pluginId);
    f.manager.enable(pluginId);
    assert.equal(f.store.module(pluginId).codeVisibility, "private");
    const dependent = structuredClone(value.module);
    dependent.id = "demo.dependent";
    dependent.contract.permissions = [];
    dependent.contract.operations = [];
    dependent.contract.importers = [];
    dependent.contract.dependencies = [
      { module: pluginId, minVersion: "1.0.0" },
    ];
    dependent.enabled = true;
    f.store.register(dependent);
    assert.throws(() => f.manager.disable(pluginId), /dependent/);
    assert.throws(() => f.manager.uninstall(pluginId), /dependent/);
    f.store.setEnabled(dependent.id, false);
    f.manager.disable(pluginId);
    f.store.setEnabled("planning", false);
    assert.throws(() => f.manager.enable(pluginId), /disabled dependency/);
  } finally {
    f.close();
  }
});

test("schema upgrades use Store migration, preserve data and expose failed migration without losing old authorization", async () => {
  const f = fixture();
  try {
    f.manager.install(f.path);
    f.manager.authorize(pluginId);
    f.manager.enable(pluginId);
    const entity = f.store.save(request({ kind: "fact", status: "active" }));
    const next = f.manifest();
    next.module.version = "1.1.0";
    next.module.schemaVersion = 2;
    next.module.entityTypes[0].fields.find(
      (field) => field.key === "waterMl",
    )!.key = "waterMillilitres";
    for (const permission of next.module.contract.permissions)
      if (permission.fields)
        permission.fields = permission.fields.map((key) =>
          key === "waterMl" ? "waterMillilitres" : key,
        );
    next.module.contract.migrations = [
      { fromSchema: 1, toSchema: 2, renames: {} },
    ];
    f.write(next);
    assert.throws(() => f.manager.upgrade(f.path), /Invalid fields/);
    assert.equal(f.store.module(pluginId).schemaVersion, 1);
    assert.equal(f.manager.list()[0].authorized, true);
    assert.equal(f.manager.list()[0].events.at(-1)?.ok, false);
    next.module.contract.migrations[0].renames = {
      waterMl: "waterMillilitres",
    };
    f.write(next);
    const upgraded = f.manager.upgrade(f.path);
    assert.ok(upgraded.backup);
    assert.equal(f.manager.list()[0].authorized, false);
    assert.equal(f.store.get(entity.id)!.fields.waterMillilitres, 30);
    assert.equal(f.store.get(entity.id)!.schemaVersion, 2);
    await assert.rejects(f.manager.invoke(pluginId, "list"), /disabled/);
    f.manager.authorize(pluginId);
    f.manager.enable(pluginId);
    assert.equal(
      ((await f.manager.invoke(pluginId, "list")) as any[])[0].fields
        .waterMillilitres,
      30,
    );
  } finally {
    f.close();
  }
});

test("stdio execution requires separate trust, stages writes until successful exit, and pins reviewed code", async () => {
  const f = fixture();
  try {
    f.manager.install(f.path);
    f.manager.authorize(pluginId);
    f.manager.enable(pluginId);
    await assert.rejects(
      f.manager.invoke(pluginId, "summarize"),
      /Trusted local code/,
    );
    assert.throws(
      () => f.manager.authorize(pluginId, { trustLocalCode: true }),
      /acknowledgement/,
    );
    f.manager.authorize(pluginId, {
      trustLocalCode: true,
      acknowledgeUnsandboxedNetwork: true,
    });
    f.manager.enable(pluginId);
    await assert.rejects(
      f.manager.invoke(pluginId, "broker-probe", {
        permission: "suggest-plants",
        action: "save",
        request: request(),
        failAfterCall: true,
      }),
      /Plugin failed/,
    );
    assert.equal(f.store.list({ module: pluginId }).length, 0);
    await f.manager.invoke(pluginId, "propose", request());
    assert.equal(f.store.list({ module: pluginId }).length, 1);
    writeFileSync(join(f.root, "code", "plugin.mjs"), "process.exit(0)");
    await assert.rejects(
      f.manager.invoke(pluginId, "summarize"),
      /code changed/,
    );
    assert.match(f.manager.list()[0].lastError!, /code changed/);
  } finally {
    f.close();
  }
});

test("managers refresh persisted authorization and revoke pending subprocess writes", async () => {
  const f = fixture();
  try {
    trusted(f);
    const other = new PluginManager(f.store);
    const running = f.manager.invoke(pluginId, "broker-probe", {
      permission: "suggest-plants",
      action: "save",
      request: request(),
      delayMs: 300,
    });
    const rejected = assert.rejects(running, /authorization changed|disabled/);
    await new Promise((resolve) => setTimeout(resolve, 100));
    other.authorize(pluginId, { permissions: ["read-plants"] });
    await rejected;
    assert.equal(f.store.list({ module: pluginId }).length, 0);
    assert.deepEqual(f.manager.list()[0].grants, ["read-plants"]);
    assert.equal(f.manager.list()[0].trustedLocalCode, false);
    other.enable(pluginId);
    await assert.rejects(
      f.manager.invoke(pluginId, "suggest", request()),
      /permission denied/,
    );
    symlinkSync(sample, join(f.root, "repository-alias"), "dir");
    assert.throws(
      () => other.install(join(f.root, "repository-alias", "manifest.json")),
      /outside repository/,
    );
  } finally {
    f.close();
  }
});

test("authorized field patches preserve hidden fields, body, source and existing links; denied fields and failed subprocesses leave rows unchanged", async () => {
  const f = fixture();
  try {
    const manifest = f.manifest();
    manifest.module.relations = [
      { id: "related", name: "Fictional link", targetModules: ["planning"] },
    ];
    f.write(manifest);
    trusted(f, ["read-plants", "write-plants"]);
    const target = f.store.save(
      request({
        module: "planning",
        type: "goal",
        fields: {},
        kind: "fact",
        status: "active",
      }),
    );
    const original = f.store.save(
      request({
        kind: "fact",
        status: "active",
        fields: {
          nickname: "Fictional fern",
          waterMl: 30,
          privateNote: "Hidden synthetic field",
        },
        body: "Fictional body retained\n",
        relations: [{ type: "related", target: target.id }],
        source: {
          namespace: "fictional-export",
          recordId: "plant-one",
          revision: "one",
          mode: "import",
        },
      }),
    );
    const patch = {
      id: original.id,
      fields: { waterMl: 45 },
      expectedVersion: original.version,
    };
    const output = (await f.manager.invoke(pluginId, "patch", patch)) as any;
    assert.equal("noteHash" in output, false);
    const edited = f.store.get(original.id)!;
    assert.equal(edited.fields.waterMl, 45);
    assert.equal(edited.fields.privateNote, original.fields.privateNote);
    assert.equal(edited.body, original.body);
    assert.deepEqual(edited.source, original.source);
    assert.deepEqual(edited.relations, original.relations);
    await assert.rejects(
      f.manager.invoke(pluginId, "patch", {
        id: original.id,
        fields: { privateNote: "Forbidden" },
        expectedVersion: edited.version,
      }),
      /field patch permission denied/,
    );
    await assert.rejects(
      f.manager.invoke(pluginId, "patch", patch),
      /Version conflict/,
    );
    await assert.rejects(
      f.manager.invoke(pluginId, "broker-probe", {
        permission: "write-plants",
        action: "patch-fields",
        request: {
          id: original.id,
          fields: { waterMl: 99 },
          expectedVersion: edited.version,
        },
        failAfterCall: true,
      }),
      /Plugin failed/,
    );
    assert.equal(f.store.get(original.id)!.fields.waterMl, 45);
    assert.equal(f.store.get(original.id)!.version, edited.version);
    assert.equal(f.store.get(original.id)!.body, original.body);
  } finally {
    f.close();
  }
});

test("Node24 permission model denies filesystem/child/worker access but permits synthetic loopback network; timeout and output failure are visible", async () => {
  const f = fixture({ timeoutMs: 500, maxOutputBytes: 8192 });
  const server = createServer((_request, response) =>
    response.end("Synthetic loopback fixture"),
  );
  try {
    trusted(f);
    const secretPath = join(f.root, "synthetic-secret.txt");
    writeFileSync(secretPath, "No real secrets");
    process.env.LIFE_PLUGIN_TEST_SECRET = "Synthetic environment canary";
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const result = await f.manager.invoke(pluginId, "runtime-probe", {
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
      f.manager.invoke(pluginId, "runtime-probe", { hang: true }),
      /timed out/,
    );
    await assert.rejects(
      f.manager.invoke(pluginId, "runtime-probe", { flood: true, secretPath }),
      /output limit/,
    );
    assert.equal(f.manager.list()[0].events.at(-1)?.ok, false);
  } finally {
    delete process.env.LIFE_PLUGIN_TEST_SECRET;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    f.close();
  }
});
