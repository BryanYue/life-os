import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/store.js";
import { ProfileManager } from "../src/profile.js";
import { projectRoot } from "../src/paths.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "life-profile-"));
  const store = new Store(join(root, "data"));
  const profile = new ProfileManager(store);
  return {
    root,
    store,
    profile,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("profile GET derives actual activation and original language choices without creating settings", () => {
  const f = fixture();
  try {
    f.store.setEnabled("health", false);
    const p = f.profile.get();
    assert.equal(p.modules.health, false);
    assert.equal(p.modules.learning, true);
    const offered = f.store
      .module("languages", false)
      .entityTypes.flatMap((t) => t.fields)
      .find((field) => field.key === "language")!.options!;
    assert.equal(
      p.languagePreferences.activeCodes.includes("fr"),
      offered.includes("法语") || offered.includes("fr"),
    );
    assert.equal(p.revision, 0);
    assert.equal(existsSync(f.profile.path), false);
    f.profile.setModuleEnabled("health", true);
    assert.equal(existsSync(f.profile.path), false);
  } finally {
    f.close();
  }
});
test("profile preference updates persist atomically with revision protection across managers", () => {
  const f = fixture();
  try {
    const second = new ProfileManager(f.store);
    const updated = f.profile.update(
      {
        languagePreferences: { activeCodes: ["ja", "en"] },
        navigation: {
          order: ["language", "projects"],
          labels: { research: "实验研究" },
        },
        history: { includeDisabled: true },
      },
      0,
    );
    assert.equal(updated.revision, 1);
    assert.deepEqual(second.get().languagePreferences.activeCodes, [
      "ja",
      "en",
    ]);
    const bytes = readFileSync(f.profile.path, "utf8");
    assert.throws(
      () => second.update({ history: { includeDisabled: false } }, 0),
      /revision conflict/,
    );
    assert.equal(readFileSync(f.profile.path, "utf8"), bytes);
    assert.equal(lstatSync(f.profile.path).mode & 0o777, 0o600);
    mkdirSync(f.profile.path + ".lock");
    assert.throws(
      () => second.update({ history: { includeDisabled: false } }, 1),
      /locked/,
    );
    rmSync(f.profile.path + ".lock", { recursive: true });
    assert.equal(
      second.update({ history: { includeDisabled: false } }, 1).revision,
      2,
    );
  } finally {
    f.close();
  }
});
test("bad, unsupported and unknown configuration is refused without resetting existing settings", () => {
  const f = fixture();
  try {
    f.profile.update({ languagePreferences: { activeCodes: ["en"] } }, 0);
    const bytes = readFileSync(f.profile.path, "utf8");
    for (const patch of [
      { navigation: { order: ["unknown"] } },
      { navigation: { moduleCategories: { missing: "health" } } },
      { modules: { health: false } },
      {
        languagePreferences: {
          customLanguages: [{ code: "en", name: "duplicate" }],
        },
      },
      { languagePreferences: { activeCodes: ["任意语言"] } },
      { extra: true },
    ])
      assert.throws(() => f.profile.update(patch, 1));
    assert.equal(readFileSync(f.profile.path, "utf8"), bytes);
    const invalid = { ...f.profile.get(), profileVersion: 2 };
    writeFileSync(f.profile.path, JSON.stringify(invalid));
    assert.throws(() => f.profile.get(), /version/);
    assert.throws(() => f.profile.update({}, 1), /version/);
    assert.equal(readFileSync(f.profile.path, "utf8"), JSON.stringify(invalid));
    writeFileSync(f.profile.path, "{bad-json");
    assert.throws(() => f.profile.get());
    assert.equal(readFileSync(f.profile.path, "utf8"), "{bad-json");
  } finally {
    f.close();
  }
});
test("category registry keeps eight independent classes and preserves custom modules", () => {
  const f = fixture();
  try {
    f.store.register({
      ...f.store.module("planning", false),
      id: "custom-work",
      name: "Custom work",
    });
    f.store.register({
      ...f.store.module("planning", false),
      id: "constructor",
      name: "Prototype-named custom module",
    });
    const categories = f.profile.categories();
    assert.equal(categories.categories.length, 8);
    assert.deepEqual(
      categories.categories.find((c) => c.id === "language")!.moduleIds,
      ["languages"],
    );
    assert.deepEqual(
      categories.categories.find((c) => c.id === "research")!.moduleIds,
      ["quant"],
    );
    assert.deepEqual(categories.unassignedModuleIds, [
      "constructor",
      "custom-work",
    ]);
    const p = f.profile.update(
      { navigation: { moduleCategories: { "custom-work": "projects" } } },
      0,
    );
    assert.equal(p.modules["custom-work"], true);
    assert.ok(
      f.profile
        .categories()
        .categories.find((c) => c.id === "projects")!
        .moduleIds.includes("custom-work"),
    );
  } finally {
    f.close();
  }
});
test("profile snapshots cannot restore activation and personal settings never enter data backups", () => {
  const f = fixture();
  let restored: Store | undefined;
  try {
    f.profile.update(
      {
        history: { includeDisabled: true },
        templatePreferences: { enabledIds: ["demo-personal"] },
      },
      0,
    );
    const saved = readFileSync(f.profile.path, "utf8");
    f.profile.setModuleEnabled("health", false);
    assert.equal(f.profile.get().modules.health, false);
    assert.equal(readFileSync(f.profile.path, "utf8"), saved);
    const backup = f.store.backup();
    assert.equal(backup.payload.includes("demo-personal"), false);
    restored = Store.restore(join(f.root, "restored"), backup);
    const profile = new ProfileManager(restored);
    assert.equal(profile.get().modules.health, false);
    assert.equal(profile.get().history.includeDisabled, false);
    assert.deepEqual(profile.get().templatePreferences.enabledIds, []);
    assert.equal(existsSync(profile.path), false);
  } finally {
    restored?.close();
    f.close();
  }
});
test("profile path stays outside the repository and symlinks are denied", () => {
  const f = fixture();
  try {
    assert.throws(
      () =>
        new ProfileManager(f.store, undefined, {
          path: join(projectRoot, "personal-profile.json"),
        }),
      /outside/,
    );
    const target = join(f.root, "other.json");
    writeFileSync(target, JSON.stringify(f.profile.get()));
    symlinkSync(target, f.profile.path);
    assert.throws(() => f.profile.get(), /profile file/);
    assert.throws(() => f.profile.update({}, 0), /profile file/);
  } finally {
    f.close();
  }
});
