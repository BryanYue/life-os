import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  initLocalConfig,
  loadLocalConfig,
  validateLocalConfig,
} from "../src/config.js";
import { entityAllowed } from "../src/permissions.js";
import { outsideRepository, projectRoot } from "../src/paths.js";
import { Store } from "../src/store.js";

const secret = "synthetic-" + "token-value-0123456789";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "life-config-"));
  const run = (entry: "cli" | "server", home: string, args: string[] = []) =>
    spawnSync(
      process.execPath,
      [
        "--import",
        join(projectRoot, "node_modules/tsx/dist/loader.mjs"),
        join(projectRoot, "src", entry + ".ts"),
        ...args,
      ],
      {
        cwd: root,
        env: { ...process.env, LIFE_OS_HOME: home, LIFE_OS_PORT: "4397" },
        encoding: "utf8",
        timeout: 20000,
      },
    );
  return {
    root,
    run,
    home: (name: string, config?: unknown) => {
      const home = join(root, name);
      mkdirSync(home, { mode: 0o700 });
      if (config !== undefined)
        writeFileSync(
          join(home, "config.json"),
          typeof config === "string" ? config : JSON.stringify(config),
          { mode: 0o600 },
        );
      return home;
    },
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("misspelled agentScopes was a silent full-module grant; strict loading rejects it without echoing values", () => {
  const f = fixture();
  try {
    const raw = {
      agentToken: secret,
      agentModules: ["planning"],
      agentScopes: { planning: { fields: [], body: false } },
    };
    const home = f.home("typo", raw);
    // The previous loader passed config.agentScope through unchecked.
    const legacy = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
    assert.equal(legacy.agentScope, undefined);
    assert.equal(
      entityAllowed({ module: "planning", type: "goal" }, legacy.agentScope),
      true,
    );
    assert.throws(
      () => loadLocalConfig(home),
      (error: Error) =>
        /unknown top-level key/.test(error.message) &&
        !error.message.includes(secret) &&
        !error.message.includes("agentScopes"),
    );
  } finally {
    f.close();
  }
});

test("config values are type-checked with the existing scope rules", () => {
  for (const bad of [
    [],
    "text",
    { agentToken: 42 },
    { agentModules: "planning" },
    { syncModules: [1] },
    { agentScope: [] },
    { agentScope: { planning: { field: ["x"] } } },
    { agentScope: { planning: { body: "yes" } } },
    { syncScope: { modules: ["planning"], entities: { family: {} } } },
  ])
    assert.throws(() => validateLocalConfig(bad), /Invalid config.json/);
  const legal = {
    agentToken: "short",
    agentModules: ["planning", "*"],
    agentScope: { planning: { entityTypes: ["goal"], body: true } },
    syncModules: ["planning"],
    syncScope: {
      modules: ["planning"],
      entities: { planning: { fields: ["measure"], body: false } },
    },
  };
  assert.deepEqual(validateLocalConfig(legal), legal);
  assert.deepEqual(validateLocalConfig({}), {});
  assert.deepEqual(validateLocalConfig({ syncScope: ["planning"] }), {
    syncScope: ["planning"],
  });
});

test("syncScope container typos and empty entity containers are rejected instead of widening the grant", () => {
  const selection = { planning: { entityIds: ["only-this"] } };
  for (const syncScope of [
    { modules: ["planning"], entitiez: selection },
    { modules: ["planning"], entities: null },
    { modules: ["planning"], entities: 0 },
    { modules: ["planning"], entities: "" },
    { modules: ["planning"], entities: false },
  ])
    assert.throws(
      () => validateLocalConfig({ syncScope }),
      (error: Error) =>
        /Invalid config.json/.test(error.message) &&
        !error.message.includes("only-this") &&
        !error.message.includes("entitiez"),
    );
  assert.deepEqual(
    validateLocalConfig({
      syncScope: { modules: ["planning"], entities: selection },
    }).syncScope,
    { modules: ["planning"], entities: selection },
  );
});

test("direct initLocalConfig refuses repository, other source checkouts and preservation archives before any write", () => {
  const f = fixture();
  try {
    const inside = join(projectRoot, "direct-config-init-" + process.pid);
    try {
      assert.throws(() => initLocalConfig(inside), /outside the repository/);
      assert.equal(existsSync(inside), false);
    } finally {
      rmSync(inside, { recursive: true, force: true });
    }
    const checkout = join(f.root, "other-checkout");
    mkdirSync(join(checkout, "src"), { recursive: true });
    writeFileSync(join(checkout, ".git"), "gitdir: elsewhere\n");
    writeFileSync(
      join(checkout, "package.json"),
      JSON.stringify({ name: "life-os" }),
    );
    writeFileSync(join(checkout, "src", "paths.ts"), "export {};\n");
    assert.throws(
      () => initLocalConfig(join(checkout, "data", "home")),
      /outside the repository/,
    );
    assert.equal(existsSync(join(checkout, "data")), false);

    const archive = f.home("archive");
    writeFileSync(
      join(archive, "workspace-copy.json"),
      JSON.stringify({ kind: "preservation-only", runnable: false }),
    );
    for (const target of [archive, join(archive, "nested")])
      assert.throws(() => initLocalConfig(target), /preservation-only archive/);
    assert.deepEqual(readdirSync(archive), ["workspace-copy.json"]);

    const notes = join(f.root, "private-notes");
    mkdirSync(join(notes, ".git"), { recursive: true });
    const allowed = join(notes, "life-os-home");
    initLocalConfig(allowed);
    assert.deepEqual(readdirSync(allowed), ["config.json"]);
  } finally {
    f.close();
  }
});

test("loader rejects symlink, FIFO, directory, oversized and malformed files; missing means empty without writes", () => {
  const f = fixture();
  try {
    const missing = join(f.root, "absent");
    assert.deepEqual(loadLocalConfig(missing), {});
    assert.equal(existsSync(missing), false);
    const empty = f.home("empty");
    assert.deepEqual(loadLocalConfig(empty), {});
    assert.deepEqual(readdirSync(empty), []);

    const outside = join(f.root, "elsewhere.json");
    writeFileSync(outside, JSON.stringify({ agentToken: secret }));
    const linked = f.home("linked");
    symlinkSync(outside, join(linked, "config.json"));
    assert.throws(() => loadLocalConfig(linked), /symlink denied/);

    const fifo = f.home("fifo");
    assert.equal(
      spawnSync("mkfifo", [join(fifo, "config.json")]).status,
      0,
      "mkfifo",
    );
    assert.throws(() => loadLocalConfig(fifo), /must be a regular file/);

    const directory = f.home("directory");
    mkdirSync(join(directory, "config.json"));
    assert.throws(() => loadLocalConfig(directory), /must be a regular file/);

    const large = f.home("large", " ".repeat(300_000) + "{}");
    assert.throws(() => loadLocalConfig(large), /too large/);

    const malformed = f.home("malformed", '{"agentToken":"' + secret);
    assert.throws(
      () => loadLocalConfig(malformed),
      (error: Error) =>
        /not valid JSON/.test(error.message) && !error.message.includes(secret),
    );
  } finally {
    f.close();
  }
});

test("CLI and server refuse an invalid config before creating the Store", () => {
  const f = fixture();
  try {
    for (const entry of ["cli", "server"] as const) {
      const home = f.home(entry, { agentToken: secret, agentScopes: {} });
      const result = f.run(
        entry,
        home,
        entry === "cli" ? ["profile", "show"] : [],
      );
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Invalid config.json/);
      assert.equal(result.stderr.includes(secret), false);
      assert.deepEqual(readdirSync(home), ["config.json"]);
    }
    const legal = f.home("legal", { syncModules: ["planning"] });
    assert.equal(f.run("cli", legal, ["profile", "show"]).status, 0);
    assert.equal(existsSync(join(legal, "life.sqlite")), true);
  } finally {
    f.close();
  }
});

test("config init writes only a new 0600 config without grants, never overwrites, and show redacts the token", () => {
  const f = fixture();
  try {
    const home = join(f.root, "new-home");
    const plain = f.run("cli", home, ["config", "init"]);
    assert.equal(plain.status, 0, plain.stderr);
    assert.deepEqual(readdirSync(home), ["config.json"]);
    assert.equal(statSync(home).mode & 0o777, 0o700);
    assert.equal(statSync(join(home, "config.json")).mode & 0o777, 0o600);
    assert.deepEqual(loadLocalConfig(home), {
      agentModules: [],
      syncModules: [],
    });
    const before = readFileSync(join(home, "config.json"));
    const again = f.run("cli", home, ["config", "init", "--agent-token"]);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /already exists; it was not overwritten/);
    assert.deepEqual(readFileSync(join(home, "config.json")), before);
    assert.deepEqual(readdirSync(home), ["config.json"]);

    const withToken = join(f.root, "token-home");
    const created = f.run("cli", withToken, [
      "config",
      "init",
      "--agent-token",
    ]);
    assert.equal(created.status, 0, created.stderr);
    const config = loadLocalConfig(withToken);
    assert.match(config.agentToken!, /^[0-9a-f]{64}$/);
    assert.deepEqual(config.agentModules, []);
    assert.deepEqual(config.syncModules, []);
    assert.equal(created.stdout.includes(config.agentToken!), false);
    const shown = f.run("cli", withToken, ["config", "show"]);
    assert.equal(shown.status, 0, shown.stderr);
    assert.equal(shown.stdout.includes(config.agentToken!), false);
    assert.equal(JSON.parse(shown.stdout).agentToken, "<redacted>");
    assert.deepEqual(readdirSync(withToken), ["config.json"]);

    const absent = join(f.root, "show-absent");
    const empty = f.run("cli", absent, ["config", "show"]);
    assert.equal(empty.status, 0, empty.stderr);
    assert.deepEqual(JSON.parse(empty.stdout), {});
    assert.equal(existsSync(absent), false);

    const inside = join(projectRoot, "config-init-" + process.pid);
    try {
      const denied = f.run("cli", inside, ["config", "init"]);
      assert.equal(denied.status, 1);
      assert.match(denied.stderr, /outside the repository/);
      assert.equal(existsSync(inside), false);
    } finally {
      rmSync(inside, { recursive: true, force: true });
    }
  } finally {
    f.close();
  }
});

test("data roots inside another Life OS source checkout are refused; ordinary Git note folders stay allowed", () => {
  const f = fixture();
  const opened: Store[] = [];
  try {
    const checkout = join(f.root, "other-checkout");
    mkdirSync(join(checkout, "src"), { recursive: true });
    writeFileSync(join(checkout, ".git"), "gitdir: elsewhere\n");
    writeFileSync(
      join(checkout, "package.json"),
      JSON.stringify({ name: "life-os" }),
    );
    writeFileSync(join(checkout, "src", "paths.ts"), "export {};\n");
    const denied = /outside the repository/;
    const nested = join(checkout, "data", "home");
    assert.throws(() => outsideRepository(nested), denied);
    assert.throws(() => new Store(nested), denied);
    assert.equal(existsSync(join(checkout, "data")), false);
    symlinkSync(checkout, join(f.root, "checkout-link"));
    assert.throws(
      () => new Store(join(f.root, "checkout-link", "linked-home")),
      denied,
    );
    assert.equal(existsSync(join(checkout, "linked-home")), false);
    const viaCli = f.run("cli", join(checkout, "cli-home"), ["config", "init"]);
    assert.equal(viaCli.status, 1);
    assert.match(viaCli.stderr, denied);
    assert.equal(existsSync(join(checkout, "cli-home")), false);

    const notes = join(f.root, "private-notes");
    mkdirSync(join(notes, ".git"), { recursive: true });
    writeFileSync(join(notes, "README.md"), "Synthetic note\n");
    opened.push(new Store(join(notes, "life-os-home")));
    const other = join(f.root, "other-node-project");
    mkdirSync(join(other, "src"), { recursive: true });
    mkdirSync(join(other, ".git"));
    writeFileSync(
      join(other, "package.json"),
      JSON.stringify({ name: "not-life-os" }),
    );
    writeFileSync(join(other, "src", "paths.ts"), "export {};\n");
    opened.push(new Store(join(other, "home")));
    const unmarked = join(f.root, "named-without-source");
    mkdirSync(join(unmarked, ".git"), { recursive: true });
    writeFileSync(
      join(unmarked, "package.json"),
      JSON.stringify({ name: "life-os" }),
    );
    opened.push(new Store(join(unmarked, "home")));
    assert.equal(opened.length, 3);
  } finally {
    for (const s of opened) s.close();
    f.close();
  }
});
