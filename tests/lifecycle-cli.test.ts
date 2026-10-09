import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/store.js";
import { projectRoot } from "../src/paths.js";
import { readKeyFile, unseal } from "../src/sealed.js";
import { listProjections } from "../src/sync.js";
import type { EntityInput, Module, SyncBootstrap } from "../src/types.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "life-lifecycle-cli-"));
  const key = join(root, "synthetic-key");
  const cli = (home: string, args: string[]) =>
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
        env: { ...process.env, LIFE_OS_HOME: home, LIFE_OS_KEY_FILE: key },
        encoding: "utf8",
        timeout: 20000,
      },
    );
  const run = (home: string, args: string[]) => {
    const result = cli(home, args);
    assert.equal(result.status, 0, args.join(" ") + ": " + result.stderr);
    return result.stdout;
  };
  const jsonFile = (name: string, value: unknown) => {
    const path = join(root, name);
    writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
    return path;
  };
  return {
    root,
    key,
    cli,
    run,
    jsonFile,
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("CLI encrypted bootstrap handles schema migration, historical replay and subsequent increments; projection files remain read-only", () => {
  const f = fixture();
  const a = join(f.root, "a"),
    b = join(f.root, "b");
  for (const home of [a, b]) {
    mkdirSync(home);
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({ syncModules: ["demo.cli-care"] }),
    );
  }
  const module: Module = {
    id: "demo.cli-care",
    name: "Synthetic CLI care",
    version: "1.0.0",
    coreApi: 1,
    schemaVersion: 1,
    codeVisibility: "public",
    enabled: true,
    entityTypes: [
      {
        id: "care",
        name: "Care",
        fields: [{ key: "waterMl", label: "Water", type: "number" }],
      },
    ],
    relations: [],
    views: ["form", "list"],
  };
  const source: EntityInput = {
    module: module.id,
    type: "care",
    title: "Synthetic private CLI title",
    kind: "fact",
    status: "done",
    occurredAt: "2030-04-01",
    timeZone: "UTC",
    fields: { waterMl: 100 },
    relations: [],
    body: "Synthetic private CLI body",
    source: {
      namespace: "synthetic-cli-care",
      recordId: "one",
      revision: "r1",
      mode: "import",
    },
  };
  try {
    f.run(a, ["keygen", f.key]);
    f.run(a, ["register", f.jsonFile("schema-1.json", module)]);
    const originalId = f
      .run(a, ["import", f.jsonFile("source-r1.json", source)])
      .trim();
    const next: Module = {
      ...module,
      version: "2.0.0",
      schemaVersion: 2,
      entityTypes: [
        {
          id: "care",
          name: "Care",
          fields: [{ key: "waterMillilitres", label: "Water", type: "number" }],
        },
      ],
    };
    f.run(a, [
      "migrate",
      f.jsonFile("schema-2.json", next),
      f.jsonFile("renames.json", { waterMl: "waterMillilitres" }),
    ]);
    const baselineFile = join(f.root, "baseline.encrypted.json");
    f.run(a, ["export-bootstrap-encrypted", baselineFile]);
    const envelope = JSON.parse(readFileSync(baselineFile, "utf8"));
    assert.equal(envelope.format, "life-os-sealed");
    assert.equal(JSON.stringify(envelope).includes(source.body), false);
    const baseline = unseal<SyncBootstrap>(
      envelope,
      "sync",
      readKeyFile(f.key),
    );
    assert.equal(baseline.records[0].schemaVersion, 2);
    const rejected = f.cli(b, ["import-bootstrap-encrypted", baselineFile]);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /manifest acceptance/);
    f.run(b, [
      "import-bootstrap-encrypted",
      baselineFile,
      "--accept-manifests",
    ]);
    assert.match(
      f.run(b, [
        "import-bootstrap-encrypted",
        baselineFile,
        "--accept-manifests",
      ]),
      /applied: 0/,
    );
    const oldHistory = join(f.root, "history.encrypted.json");
    f.run(a, ["export-sync-encrypted", oldHistory, "0"]);
    assert.match(f.run(b, ["import-sync-encrypted", oldHistory]), /applied: 0/);
    f.run(a, [
      "import",
      f.jsonFile("source-r2.json", {
        ...source,
        fields: { waterMillilitres: 125 },
        source: { ...source.source!, revision: "r2" },
      }),
    ]);
    const increment = join(f.root, "increment.encrypted.json");
    f.run(a, ["export-sync-encrypted", increment, String(baseline.cursor)]);
    assert.match(f.run(b, ["import-sync-encrypted", increment]), /applied: 1/);
    const scope = {
      modules: [module.id],
      entities: {
        [module.id]: { entityIds: [originalId], fields: ["waterMillilitres"] },
      },
    };
    for (const home of [a, b])
      writeFileSync(
        join(home, "config.json"),
        JSON.stringify({ syncScope: scope }),
      );
    const projectionFile = join(f.root, "projection.json");
    f.run(a, ["export-projection", projectionFile]);
    const projection = JSON.parse(readFileSync(projectionFile, "utf8"));
    assert.equal(projection.mode, "projection");
    assert.equal(projection.records[0].title, "");
    assert.equal(projection.records[0].body, "");
    assert.deepEqual(projection.records[0].fields, { waterMillilitres: 125 });
    f.run(b, ["import-projection", projectionFile]);
    assert.match(f.run(b, ["projections"]), /readOnly: true/);
    const target = new Store(b);
    try {
      assert.equal(target.list().length, 1);
      assert.equal(target.get(originalId)!.schemaVersion, 2);
      assert.equal(target.get(originalId)!.fields.waterMillilitres, 125);
      assert.equal(target.get(originalId)!.body, source.body);
      assert.equal(target.conflicts().length, 0);
      assert.equal(listProjections(target).length, 1);
    } finally {
      target.close();
    }
  } finally {
    f.close();
  }
});

test("CLI plugins enforce repository boundaries and persist install, authorize, enable, import, invoke and disable across processes", () => {
  const f = fixture(),
    home = join(f.root, "data");
  const code = join(f.root, "code"),
    id = "demo.plugin-plants";
  cpSync(join(projectRoot, "examples/plugin-plants"), code, {
    recursive: true,
  });
  const input: EntityInput = {
    module: id,
    type: "plant",
    title: "Synthetic CLI fern",
    kind: "inference",
    status: "draft",
    occurredAt: "2030-04-01",
    timeZone: "UTC",
    fields: { nickname: "Synthetic CLI fern", waterMl: 40 },
    relations: [],
    body: "Synthetic CLI suggestion",
  };
  try {
    const repositoryManifest = f.cli(home, [
      "plugins",
      "install",
      join(projectRoot, "examples/plugin-plants/manifest.json"),
    ]);
    assert.notEqual(repositoryManifest.status, 0);
    assert.match(repositoryManifest.stderr, /outside repository/);
    f.run(home, ["plugins", "install", join(code, "manifest.json")]);
    const unauthorized = f.cli(home, ["plugins", "enable", id]);
    assert.notEqual(unauthorized.status, 0);
    assert.match(unauthorized.stderr, /authorization/);
    f.run(home, [
      "plugins",
      "authorize",
      id,
      f.jsonFile("authorization.json", {
        permissions: ["read-plants", "suggest-plants"],
        trustLocalCode: true,
        acknowledgeUnsandboxedNetwork: true,
      }),
    ]);
    f.run(home, ["plugins", "enable", id]);
    f.run(home, [
      "plugins",
      "import",
      id,
      "draft-json",
      f.jsonFile("draft.json", { entity: input, expectedVersion: 0 }),
    ]);
    const summarized = f.run(home, ["plugins", "invoke", id, "summarize"]);
    assert.match(summarized, /count: 1/);
    assert.match(summarized, /waterMl: 40/);
    f.run(home, ["plugins", "disable", id]);
    assert.match(f.run(home, ["plugins", "list"]), /state: 'disabled'/);
    const disabled = f.cli(home, ["plugins", "invoke", id, "summarize"]);
    assert.notEqual(disabled.status, 0);
    assert.match(disabled.stderr, /disabled/);
    f.run(home, ["plugins", "uninstall", id]);
    const target = new Store(home);
    try {
      assert.equal(target.module(id, false).enabled, false);
      assert.equal(target.list({ module: id }).length, 1);
      assert.equal(target.list({ module: id })[0].kind, "inference");
    } finally {
      target.close();
    }
    const forbiddenHome = join(projectRoot, "forbidden-lifecycle-data");
    assert.equal(existsSync(forbiddenHome), false);
    const rejectedHome = f.cli(forbiddenHome, ["plugins", "list"]);
    assert.notEqual(rejectedHome.status, 0);
    assert.match(rejectedHome.stderr, /outside the repository/);
    assert.equal(existsSync(forbiddenHome), false);
  } finally {
    f.close();
  }
});

test("CLI research and Apple Health examples import as unrun proposal and two source-tracked health facts, with safe replay", () => {
  const f = fixture(),
    home = join(f.root, "example-data");
  const research = join(projectRoot, "examples/research-result.json"),
    health = join(projectRoot, "examples/apple-health-export.xml");
  try {
    const proposalId = f.run(home, ["import-research", research]).trim();
    assert.equal(f.run(home, ["import-research", research]).trim(), proposalId);
    for (let pass = 0; pass < 2; pass++) {
      const result = f.run(home, [
        "import-apple-health",
        health,
        "UTC",
        "synthetic-cli-example",
      ]);
      assert.match(result, /imported: 2/);
      assert.match(result, /errors: \[\]/);
    }
    const store = new Store(home);
    try {
      const proposals = store.list({ module: "quant" });
      assert.equal(proposals.length, 1);
      assert.equal(proposals[0].id, proposalId);
      assert.equal(proposals[0].kind, "plan");
      assert.equal(proposals[0].status, "draft");
      assert.equal(proposals[0].fields.result, "");
      const facts = store.list({ module: "health" });
      assert.equal(facts.length, 2);
      assert.equal(
        facts.every(
          (e) =>
            e.kind === "fact" &&
            e.status === "done" &&
            e.source.mode === "import",
        ),
        true,
      );
      assert.equal(
        facts.find((e) => e.fields.metric === "steps")!.fields.value,
        100,
      );
      assert.equal(
        facts.find((e) => e.fields.metric === "duration")!.fields.value,
        10,
      );
      assert.equal(
        facts.every((e) => e.version === 1),
        true,
      );
    } finally {
      store.close();
    }
  } finally {
    f.close();
  }
});
