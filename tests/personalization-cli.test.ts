import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Store } from "../src/store.js";
import type { Module } from "../src/types.js";

const repository = fileURLToPath(new URL("..", import.meta.url));
const date = { occurredAt: "2030-04-01T09:00:00Z", timeZone: "UTC" };
function fixture() {
  const root = realpathSync(
      mkdtempSync(join(tmpdir(), "life-personalization-cli-")),
    ),
    data = join(root, "data");
  new Store(data).close();
  return {
    root,
    data,
    close() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
type Fixture = ReturnType<typeof fixture>;
function input(f: Fixture, name: string, value: unknown) {
  const path = join(f.root, name + ".json");
  writeFileSync(path, JSON.stringify(value));
  return path;
}
function cli(f: Fixture, args: string[], expected = 0, home = f.data) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", resolve(repository, "src/cli.ts"), ...args],
    {
      cwd: repository,
      env: {
        ...process.env,
        LIFE_OS_HOME: home,
        TMPDIR: f.root,
        NODE_NO_WARNINGS: "1",
      },
      encoding: "utf8",
      timeout: 20000,
    },
  );
  assert.ifError(result.error);
  assert.equal(
    result.status,
    expected,
    `${args[0]}: ${result.stderr}\n${result.stdout}`,
  );
  return result;
}
function inspect<T>(f: Fixture, action: (store: Store) => T): T {
  const store = new Store(f.data);
  try {
    return action(store);
  } finally {
    store.close();
  }
}
function files(root: string) {
  return readdirSync(root, { recursive: true })
    .map(String)
    .sort()
    .map((path) => {
      try {
        return [path, readFileSync(join(root, path)).toString("base64")];
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EISDIR")
          return [path, "directory"];
        throw error;
      }
    });
}
function state(f: Fixture) {
  return {
    backup: inspect(f, (store) => store.backup()),
    files: files(f.data).filter(([path]) => !path.startsWith("life.sqlite")),
  };
}

test("CLI profile/catalog reads create no personal config; revision protection and bad persisted settings survive process restarts", () => {
  const f = fixture();
  try {
    const before = state(f);
    for (const args of [
      ["profile", "show"],
      ["modules", "list"],
      ["categories"],
      ["language-upgrades"],
      ["templates", "list"],
    ])
      cli(f, args);
    assert.deepEqual(state(f), before);
    assert.equal(existsSync(join(f.data, "personal-profile.json")), false);
    const patch = input(f, "profile-patch", {
      languagePreferences: {
        activeCodes: ["ko"],
        customLanguages: [{ code: "ko", name: "韩语" }],
      },
      navigation: { labels: { learning: "Synthetic studies" } },
    });
    const updated = JSON.parse(
      cli(f, ["profile", "update", patch, "0"]).stdout,
    );
    assert.equal(updated.revision, 1);
    assert.equal(updated.languagePreferences.customLanguages[0].code, "ko");
    const saved = state(f);
    assert.match(
      cli(f, ["profile", "update", patch, "0"], 1).stderr,
      /revision conflict/,
    );
    const bad = input(f, "invalid-profile-patch", {
      navigation: { order: ["unknown-category"] },
    });
    assert.match(
      cli(f, ["profile", "update", bad, "1"], 1).stderr,
      /Unknown navigation/,
    );
    assert.deepEqual(state(f), saved);
    assert.equal(
      JSON.parse(cli(f, ["profile", "show"]).stdout).navigation.labels.learning,
      "Synthetic studies",
    );
    const profilePath = join(f.data, "personal-profile.json"),
      malformed = '{"profileVersion":99,"revision":1}';
    writeFileSync(profilePath, malformed);
    assert.match(cli(f, ["profile", "show"], 1).stderr, /Unsupported profile/);
    assert.equal(readFileSync(profilePath, "utf8"), malformed);
  } finally {
    f.close();
  }
});

test("CLI added languages require explicit migration; disable/restart/re-enable retains data and direct executable enable is refused", () => {
  const f = fixture();
  try {
    const patch = input(f, "korean-profile", {
      languagePreferences: {
        activeCodes: ["ko"],
        customLanguages: [{ code: "ko", name: "韩语" }],
      },
    });
    cli(f, ["profile", "update", patch, "0"]);
    assert.equal(
      inspect(f, (store) => store.module("languages").schemaVersion),
      2,
    );
    const entity = {
      ...date,
      module: "languages",
      type: "practice",
      title: "Fictional Korean CLI practice",
      kind: "fact",
      status: "done",
      fields: { language: "ko", skill: "读", minutes: 11 },
      relations: [],
      body: "Original synthetic history",
      source: {
        namespace: "synthetic-cli",
        recordId: "korean-1",
        revision: "1",
        mode: "import",
      },
    };
    const entityFile = input(f, "korean-entity", entity),
      unchanged = state(f);
    assert.match(cli(f, ["import", entityFile], 1).stderr, /Invalid fields/);
    assert.deepEqual(state(f), unchanged);
    const upgraded = JSON.parse(
      cli(f, ["upgrade-languages", "languages"]).stdout,
    );
    assert.equal(upgraded.toSchema, 3);
    assert.ok(existsSync(upgraded.backup));
    const id = cli(f, ["import", entityFile]).stdout.trim();
    assert.equal(
      inspect(f, (store) => store.get(id)!.fields.language),
      "ko",
    );
    cli(f, ["modules", "disable", "languages"]);
    assert.equal(
      JSON.parse(cli(f, ["profile", "show"]).stdout).modules.languages,
      false,
    );
    assert.equal(
      inspect(f, (store) => store.get(id)!.body),
      entity.body,
    );
    const deniedFile = input(f, "disabled-new-entity", {
      ...entity,
      source: { ...entity.source, recordId: "korean-2" },
    });
    assert.match(cli(f, ["import", deniedFile], 1).stderr, /Module disabled/);
    cli(f, ["modules", "enable", "languages"]);
    assert.equal(
      inspect(f, (store) => store.list({ module: "languages" }).length),
      1,
    );
    assert.equal(
      inspect(f, (store) => store.get(id)!.body),
      entity.body,
    );
    const executable: Module = {
      id: "personal.cli-contract",
      name: "Fictional CLI executable module",
      version: "0.1.0",
      coreApi: 1,
      schemaVersion: 1,
      codeVisibility: "private",
      enabled: true,
      entityTypes: [{ id: "record", name: "Record", fields: [] }],
      relations: [],
      views: ["list"],
      contract: {
        protocol: 1,
        core: { api: 1, minVersion: "0.1.0" },
        dependencies: [],
        permissions: [],
        operations: [],
        importers: [],
      },
    };
    const enabled = input(f, "enabled-contract", executable);
    assert.match(
      cli(f, ["register", enabled], 1).stderr,
      /authorization before enabling/,
    );
    const disabled = input(f, "disabled-contract", {
      ...executable,
      enabled: false,
    });
    cli(f, ["register", disabled]);
    const registered = state(f);
    cli(f, ["modules", "enable", executable.id], 1);
    assert.deepEqual(state(f), registered);
    assert.equal(
      inspect(f, (store) => store.module(executable.id, false).enabled),
      false,
    );
  } finally {
    f.close();
  }
});

test("CLI declarative template registration/preview creates no facts or plans; apply retries remain idempotent between processes", () => {
  const f = fixture();
  try {
    const template = {
      id: "personal.cli-reading",
      version: 1,
      name: "Fictional CLI reading plan",
      requires: ["learning"],
      parameters: [],
      target: {
        module: "learning",
        type: "checklist-item",
        kind: "plan",
        status: "draft",
      },
      defaults: {
        title: "Fictional reading plan",
        fields: { focus: "Synthetic question" },
      },
    };
    cli(f, [
      "templates",
      "register",
      input(f, "template-definition", template),
    ]);
    assert.equal(
      inspect(f, (store) => store.list().length),
      0,
    );
    const previewRequest = { ...date, templateId: template.id },
      before = state(f);
    const preview = JSON.parse(
      cli(f, [
        "templates",
        "preview",
        input(f, "template-preview", previewRequest),
      ]).stdout,
    );
    assert.equal(preview.entity.kind, "plan");
    assert.deepEqual(state(f), before);
    const request = input(f, "template-apply", {
      ...previewRequest,
      operationId: "cli-personal-reading-plan",
    });
    const first = JSON.parse(cli(f, ["templates", "apply", request]).stdout),
      after = state(f);
    const retry = JSON.parse(cli(f, ["templates", "apply", request]).stdout);
    assert.equal(retry.id, first.id);
    assert.deepEqual(state(f), after);
    assert.equal(
      inspect(f, (store) => store.list().length),
      1,
    );
    assert.equal(
      inspect(f, (store) => store.list()[0].kind),
      "plan",
    );
    const changed = input(f, "changed-template-receipt", {
      ...previewRequest,
      operationId: "cli-personal-reading-plan",
      occurredAt: "2030-04-02T09:00:00Z",
    });
    assert.match(
      cli(f, ["templates", "apply", changed], 1).stderr,
      /Operation ID reused/,
    );
    assert.deepEqual(state(f), after);
  } finally {
    f.close();
  }
});

test("CLI preservation requires explicit offline confirmation and both package/archive reject startup markers before opening a database", () => {
  const f = fixture();
  try {
    writeFileSync(
      join(f.data, "config.json"),
      JSON.stringify({
        syntheticPrivateSetting: "fictional-only",
        syncModules: [],
      }),
    );
    writeFileSync(
      join(f.data, "plugins.json"),
      JSON.stringify({ fictionalPreservedGrant: "must-not-activate" }),
    );
    const source = files(f.data),
      target = join(f.root, "preservation");
    assert.match(
      cli(f, ["preserve-workspace", f.data, target], 1).stderr,
      /offline-confirmed/,
    );
    assert.equal(existsSync(target), false);
    assert.deepEqual(files(f.data), source);
    cli(f, ["preserve-workspace", f.data, target, "--offline-confirmed"]);
    const marker = JSON.parse(
      readFileSync(join(target, "workspace-copy.json"), "utf8"),
    );
    assert.equal(marker.kind, "preservation-only");
    assert.equal(marker.runnable, false);
    assert.equal(
      marker.pluginAuthorization,
      "archived-requires-fresh-authorization",
    );
    assert.deepEqual(files(join(target, "archive")), source);
    assert.deepEqual(files(f.data), source);
    const preserved = files(target);
    for (const home of [target, join(target, "archive")]) {
      assert.match(
        cli(f, ["profile", "show"], 1, home).stderr,
        /preservation-only archive/,
      );
      const backup = join(f.root, "forbidden-backup.json");
      assert.match(
        cli(f, ["backup", backup], 1, home).stderr,
        /preservation-only archive/,
      );
      assert.equal(existsSync(backup), false);
    }
    assert.deepEqual(files(target), preserved);
    assert.equal(existsSync(join(target, "life.sqlite")), false);
  } finally {
    f.close();
  }
});
