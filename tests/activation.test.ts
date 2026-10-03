import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/store.js";
import { PluginManager } from "../src/plugins.js";
import { ProfileManager } from "../src/profile.js";
import { projectRoot } from "../src/paths.js";
import type { PluginManifest } from "../src/plugins.js";

const id = "demo.plugin-plants";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "life-activation-"));
  cpSync(join(projectRoot, "examples/plugin-plants"), join(root, "code"), {
    recursive: true,
  });
  const store = new Store(join(root, "data"));
  const manager = new PluginManager(store);
  const profile = new ProfileManager(store, manager);
  const manifestPath = join(root, "code", "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.module.contract.dependencies = [
    { module: "planning", minVersion: "0.1.0" },
  ];
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return {
    root,
    store,
    manager,
    profile,
    manifestPath,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("Store and profile activation cannot bypass plugin installation, authorization or dependencies", () => {
  const f = fixture();
  try {
    f.manager.install(f.manifestPath);
    assert.throws(() => f.store.setEnabled(id, true), /authorization/);
    assert.throws(() => f.profile.setModuleEnabled(id, true), /authorization/);
    f.manager.authorize(id);
    f.store.setEnabled(id, true);
    assert.equal(f.manager.list()[0].state, "enabled");
    const dependent = { ...f.store.module(id), id: "demo.dependent" };
    dependent.contract = {
      ...dependent.contract!,
      permissions: [],
      operations: [],
      importers: [],
      dependencies: [{ module: id, minVersion: "1.0.0" }],
    };
    f.store.register(dependent);
    assert.throws(() => f.profile.setModuleEnabled(id, false), /dependent/);
    assert.throws(() => f.store.setEnabled("planning", false), /dependent/);
    f.store.setEnabled(dependent.id, false);
    f.profile.setModuleEnabled(id, false);
    f.profile.setModuleEnabled("planning", false);
    assert.throws(
      () => f.profile.setModuleEnabled(id, true),
      /disabled dependency/,
    );
    assert.equal(f.store.module(id, false).enabled, false);
  } finally {
    f.close();
  }
});
test("Store without PluginManager checks dependencies and rejects contract activation", () => {
  const f = fixture();
  let other: Store | undefined;
  try {
    other = new Store(join(f.root, "other"));
    const manifest = JSON.parse(readFileSync(f.manifestPath, "utf8"));
    other.register({ ...manifest.module, enabled: true });
    assert.throws(() => other!.setEnabled("planning", false), /dependent/);
    other.setEnabled(id, false);
    assert.throws(() => other!.setEnabled(id, true), /authorization/);
  } finally {
    other?.close();
    f.close();
  }
});
test("activation persistence failure rolls back SQLite state and execution state", () => {
  const f = fixture();
  try {
    f.manager.install(f.manifestPath);
    f.manager.authorize(id);
    const previous = f.manager.list()[0];
    const manager = f.manager as unknown as { persist: () => void };
    const persist = manager.persist;
    let writes = 0;
    manager.persist = function () {
      writes++;
      if (writes === 2)
        throw Error("Simulated private state persistence failure");
      persist.call(f.manager);
    };
    assert.throws(
      () => f.profile.setModuleEnabled(id, true),
      /persistence failure/,
    );
    assert.equal(f.store.module(id, false).enabled, false);
    assert.equal(f.manager.list()[0].state, previous.state);
    assert.deepEqual(f.manager.list()[0].grants, previous.grants);
    assert.equal(f.manager.list()[0].authorized, true);
    manager.persist = persist;
    f.profile.setModuleEnabled(id, true);
    assert.equal(f.store.module(id).enabled, true);
  } finally {
    f.close();
  }
});
test("disabled histories stay readable while enabledOnly excludes them", () => {
  const f = fixture();
  try {
    const entity = f.store.save({
      expectedVersion: 0,
      entity: {
        module: "planning",
        type: "direction",
        title: "Historical direction",
        kind: "fact",
        status: "active",
        occurredAt: "2030-01-01",
        timeZone: "UTC",
        fields: { why: "Synthetic fixture" },
        relations: [],
        body: "History",
      },
    });
    f.profile.setModuleEnabled("planning", false);
    assert.equal(f.store.get(entity.id)!.title, "Historical direction");
    assert.equal(f.store.list({ module: "planning" }).length, 1);
    assert.equal(f.store.list({ enabledOnly: true }).length, 0);
    assert.throws(
      () =>
        f.store.save({
          entity,
          expectedVersion: entity.version,
          expectedNoteHash: entity.noteHash,
        }),
      /disabled/,
    );
  } finally {
    f.close();
  }
});
test("restored plugin data stays disabled without reusing profile snapshots or grants", () => {
  const f = fixture();
  let restored: Store | undefined;
  try {
    f.manager.install(f.manifestPath);
    f.manager.authorize(id);
    f.profile.setModuleEnabled(id, true);
    f.profile.update({ history: { includeDisabled: true } }, 0);
    restored = Store.restore(join(f.root, "restored"), f.store.backup());
    const manager = new PluginManager(restored);
    const profile = new ProfileManager(restored, manager);
    assert.equal(profile.get().modules[id], false);
    assert.deepEqual(manager.list(), []);
    assert.throws(() => profile.setModuleEnabled(id, true), /not installed/);
    assert.equal(profile.setModuleEnabled(id, false).modules[id], false);
  } finally {
    restored?.close();
    f.close();
  }
});

test("a blocked plugin schema upgrade preserves data, activation and previous authorization", () => {
  const f = fixture();
  try {
    f.manager.install(f.manifestPath);
    f.manager.authorize(id);
    f.manager.enable(id);
    const entity = f.store.save({
      expectedVersion: 0,
      entity: {
        module: id,
        type: "plant",
        title: "Fictional fern",
        kind: "fact",
        status: "active",
        occurredAt: "2030-01-01",
        timeZone: "UTC",
        fields: { nickname: "Fern", waterMl: 30 },
        relations: [],
        body: "Synthetic upgrade fixture",
      },
    });
    const dependent = structuredClone(f.store.module(id));
    dependent.id = "demo.upgrade-dependent";
    dependent.contract = {
      ...dependent.contract!,
      permissions: [],
      operations: [],
      importers: [],
      dependencies: [{ module: id, minVersion: "1.0.0" }],
    };
    f.store.register(dependent);
    const next = JSON.parse(readFileSync(f.manifestPath, "utf8"));
    next.module.version = "1.1.0";
    next.module.schemaVersion = 2;
    next.module.entityTypes[0].fields.find(
      (field: { key: string }) => field.key === "waterMl",
    ).key = "waterMillilitres";
    for (const permission of next.module.contract.permissions)
      if (permission.fields)
        permission.fields = permission.fields.map((key: string) =>
          key === "waterMl" ? "waterMillilitres" : key,
        );
    next.module.contract.migrations = [
      { fromSchema: 1, toSchema: 2, renames: { waterMl: "waterMillilitres" } },
    ];
    writeFileSync(f.manifestPath, JSON.stringify(next));
    const previous = f.manager.list()[0];
    const data = f.store.backup();
    const backups = readdirSync(f.store.root).filter((name) =>
      name.startsWith("migration-backup-"),
    );
    assert.throws(() => f.manager.upgrade(f.manifestPath), /dependent/);
    assert.equal(f.store.backup().sha256, data.sha256);
    assert.equal(f.store.module(id).schemaVersion, 1);
    assert.equal(f.store.get(entity.id)!.fields.waterMl, 30);
    assert.equal(f.manager.list()[0].authorized, previous.authorized);
    assert.equal(f.manager.list()[0].state, previous.state);
    assert.deepEqual(f.manager.list()[0].grants, previous.grants);
    assert.deepEqual(
      readdirSync(f.store.root).filter((name) =>
        name.startsWith("migration-backup-"),
      ),
      backups,
    );
  } finally {
    f.close();
  }
});

test("schema migration preserves both enabled and disabled states and cannot grant plugin activation", () => {
  const f = fixture();
  try {
    f.store.setEnabled("health", false);
    f.store.migrateModule({
      ...f.store.module("health", false),
      schemaVersion: 2,
      enabled: true,
    });
    assert.equal(f.store.module("health", false).enabled, false);
    f.store.migrateModule({
      ...f.store.module("planning"),
      schemaVersion: 2,
      enabled: false,
    });
    assert.equal(f.store.module("planning").enabled, true);
    f.manager.install(f.manifestPath);
    const previous = f.manager.list()[0];
    f.store.migrateModule({
      ...f.store.module(id, false),
      schemaVersion: 2,
      enabled: true,
    });
    assert.equal(f.store.module(id, false).enabled, false);
    assert.equal(f.manager.list()[0].authorized, previous.authorized);
    assert.deepEqual(f.manager.list()[0].grants, []);
    assert.throws(() => f.store.setEnabled(id, true), /authorization/);
  } finally {
    f.close();
  }
});

function prepareUpgrade(f: ReturnType<typeof fixture>, schemaChange: boolean) {
  f.manager.install(f.manifestPath);
  f.manager.authorize(id);
  f.manager.enable(id);
  const entity = f.store.save({
    expectedVersion: 0,
    entity: {
      module: id,
      type: "plant",
      title: "Upgrade fern",
      kind: "fact",
      status: "active",
      occurredAt: "2030-01-01",
      timeZone: "UTC",
      fields: { nickname: "Fern", waterMl: 30 },
      relations: [],
      body: "Synthetic persistence fixture",
    },
  });
  const next = JSON.parse(
    readFileSync(f.manifestPath, "utf8"),
  ) as PluginManifest;
  next.module.version = "1.1.0";
  if (schemaChange) {
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
      { fromSchema: 1, toSchema: 2, renames: { waterMl: "waterMillilitres" } },
    ];
  }
  writeFileSync(f.manifestPath, JSON.stringify(next));
  return entity;
}

for (const schemaChange of [false, true]) {
  test(`plugin upgrade persistence failure rolls back ${schemaChange ? "schema and entity history" : "same-schema version"} and retains prior grants`, () => {
    const f = fixture();
    try {
      const entity = prepareUpgrade(f, schemaChange);
      const before = f.store.backup(),
        previous = f.manager.list()[0];
      const manager = f.manager as unknown as { persist: () => void };
      const persist = manager.persist;
      manager.persist = () => {
        throw Error("Simulated upgrade persistence failure");
      };
      assert.throws(
        () => f.manager.upgrade(f.manifestPath),
        /persistence failure/,
      );
      assert.equal(f.store.backup().sha256, before.sha256);
      assert.equal(f.store.module(id).version, "1.0.0");
      assert.equal(f.store.get(entity.id)!.fields.waterMl, 30);
      const state = f.manager.list()[0];
      assert.equal(state.state, previous.state);
      assert.equal(state.authorized, true);
      assert.deepEqual(state.manifest, previous.manifest);
      assert.deepEqual(state.grants, previous.grants);
      manager.persist = persist;
      let writes = 0;
      manager.persist = function () {
        writes++;
        persist.call(f.manager);
      };
      f.manager.upgrade(f.manifestPath);
      assert.equal(writes, 1, "success has no required postcommit state write");
      assert.equal(f.store.module(id, false).enabled, false);
      assert.equal(f.store.module(id, false).version, "1.1.0");
      assert.equal(f.manager.list()[0].authorized, false);
    } finally {
      f.close();
    }
  });
}

test("postcommit note failure retains new manifest and revoked grants until note recovery", async () => {
  const f = fixture();
  try {
    const entity = prepareUpgrade(f, true);
    const flush = f.store.flushNotes;
    f.store.flushNotes = () => {
      if (
        Number(
          f.store.db.prepare("SELECT COUNT(*) AS n FROM pending_notes").get()!
            .n,
        ) > 0
      )
        throw Error("Simulated note recovery failure");
      flush.call(f.store);
    };
    assert.throws(
      () => f.manager.upgrade(f.manifestPath),
      /upgrade committed.*note recovery/,
    );
    assert.equal(f.store.module(id, false).schemaVersion, 2);
    assert.equal(f.store.module(id, false).enabled, false);
    assert.equal(f.store.get(entity.id)!.fields.waterMillilitres, 30);
    assert.equal(f.manager.list()[0].manifest.module.schemaVersion, 2);
    assert.equal(f.manager.list()[0].state, "disabled");
    assert.equal(f.manager.list()[0].authorized, false);
    assert.deepEqual(f.manager.list()[0].grants, []);
    assert.match(f.manager.list()[0].lastError!, /upgrade committed/);
    assert.throws(() => f.manager.authorize(id), /note recovery/);
    await assert.rejects(
      f.manager.invoke(id, "list"),
      /disabled or unauthorized/,
    );
    f.store.flushNotes = flush;
    f.store.flushNotes();
    f.manager.authorize(id);
    f.manager.enable(id);
    assert.equal(f.store.module(id).schemaVersion, 2);
  } finally {
    f.close();
  }
});

test("uncertain filesystem write outcome keeps a disabled gate and supports retry before authorization", () => {
  const f = fixture();
  try {
    prepareUpgrade(f, true);
    const before = f.store.backup();
    const manager = f.manager as unknown as { persist: () => void };
    const persist = manager.persist;
    let writes = 0;
    manager.persist = function () {
      persist.call(f.manager);
      if (++writes === 1) throw Error("Simulated failure after atomic rename");
    };
    assert.throws(() => f.manager.upgrade(f.manifestPath), /requires recovery/);
    assert.equal(f.store.backup().sha256, before.sha256);
    assert.equal(f.manager.list()[0].manifest.module.schemaVersion, 2);
    assert.equal(f.manager.list()[0].state, "disabled");
    assert.equal(f.manager.list()[0].authorized, false);
    assert.throws(() => f.manager.authorize(id), /complete upgrade recovery/);
    assert.throws(
      () => f.store.setEnabled(id, true),
      /complete upgrade recovery/,
    );
    manager.persist = persist;
    f.manager.upgrade(f.manifestPath);
    assert.equal(f.store.module(id, false).schemaVersion, 2);
    assert.equal(f.store.module(id, false).enabled, false);
    f.manager.authorize(id);
    f.manager.enable(id);
  } finally {
    f.close();
  }
});

test("SQLite COMMIT failure after persisting the gate revokes execution until upgrade retry", () => {
  const f = fixture();
  try {
    prepareUpgrade(f, true);
    const before = f.store.backup();
    const exec = f.store.db.exec;
    let failed = false;
    f.store.db.exec = function (sql: string) {
      if (
        !failed &&
        sql === "COMMIT" &&
        f.store.module(id, false).schemaVersion === 2
      ) {
        failed = true;
        throw Error("Simulated SQLite COMMIT failure");
      }
      return exec.call(f.store.db, sql);
    };
    assert.throws(
      () => f.manager.upgrade(f.manifestPath),
      /requires recovery.*COMMIT failure/,
    );
    assert.equal(f.store.backup().sha256, before.sha256);
    assert.equal(f.manager.list()[0].manifest.module.schemaVersion, 2);
    assert.equal(f.manager.list()[0].state, "disabled");
    assert.equal(f.manager.list()[0].authorized, false);
    assert.deepEqual(f.manager.list()[0].grants, []);
    assert.throws(() => f.manager.authorize(id), /complete upgrade recovery/);
    assert.throws(() => f.manager.enable(id), /complete upgrade recovery/);
    f.store.db.exec = exec;
    f.manager.upgrade(f.manifestPath);
    assert.equal(f.store.module(id, false).schemaVersion, 2);
    assert.equal(f.store.module(id, false).enabled, false);
    f.manager.authorize(id);
    f.manager.enable(id);
  } finally {
    f.close();
  }
});
