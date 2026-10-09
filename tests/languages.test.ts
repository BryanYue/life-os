import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/store.js";
import { app } from "../src/server.js";
import {
  languageCatalog,
  languageLabel,
  languageOptions,
  normalizeLanguage,
  validateActiveLanguageCodes,
} from "../src/languages.js";
import {
  pendingBuiltinLanguageUpgrades,
  upgradeBuiltinLanguages,
} from "../src/builtin-upgrades.js";
import {
  addReadingExplanation,
  addReadingVocabulary,
  createReadingMaterial,
  readingReport,
  recordReading,
} from "../src/reading.js";

const date = { occurredAt: "2030-04-01T09:00:00Z", timeZone: "UTC" };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "life-language-fixture-"));
  const store = new Store(join(root, "data"));
  return {
    root,
    store,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
function material(store: Store, operationId: string, language: string) {
  return createReadingMaterial(store, {
    ...date,
    operationId,
    language,
    title: "Fictional multilingual reading",
    reference: "synthetic://multilingual",
    sourceType: "技术文档",
    rights: "虚构样例",
    body: "An entirely fictional original text.",
  });
}

test("language identity, catalog and active study are independent of historical values", () => {
  const catalog = languageCatalog([{ code: "KO", name: "韩语" }]);
  assert.equal(normalizeLanguage("英语"), "en");
  assert.equal(normalizeLanguage("EN-us"), "en-US");
  assert.equal(normalizeLanguage("ko"), "ko");
  assert.equal(normalizeLanguage("invalid_locale"), null);
  assert.equal(normalizeLanguage("德语"), null);
  assert.equal(languageLabel("ko", catalog), "韩语");
  assert.equal(languageLabel("旧方言", catalog), "旧方言");
  assert.deepEqual(validateActiveLanguageCodes(["英语", "en", "KO"]), [
    "en",
    "ko",
  ]);
  assert.deepEqual(languageOptions(catalog, [], ["英语", "ko", "旧方言"]), [
    { value: "英语", label: "英语" },
    { value: "ko", label: "韩语" },
    { value: "旧方言", label: "旧方言" },
  ]);
  assert.throws(
    () => languageCatalog([{ code: "EN", name: "Duplicate" }]),
    /duplicate/,
  );
  assert.throws(
    () => languageCatalog([{ code: "英语", name: "Label as code" }]),
    /Invalid/,
  );
  assert.throws(() => languageCatalog([{ code: "ko", name: " " }]), /Invalid/);
  assert.throws(
    () => validateActiveLanguageCodes(["ko", "../other"]),
    /Invalid/,
  );
});

test("schema 2 resolves compatible codes before writes and requires explicit upgrades for other languages", () => {
  const f = fixture();
  try {
    const english = material(f.store, "legacy-compatible-code", "en");
    assert.equal(english.fields.language, "英语");
    const before = f.store.backup();
    assert.throws(
      () => material(f.store, "korean-before-upgrade", "ko"),
      /explicit learning/,
    );
    assert.deepEqual(f.store.backup(), before);
    upgradeBuiltinLanguages(f.store, "learning");
    const korean = material(f.store, "korean-after-upgrade", "KO");
    assert.equal(korean.fields.language, "ko");
    const session = recordReading(f.store, {
      ...date,
      operationId: "korean-session",
      materialId: korean.id,
      minutes: 13,
      goalIds: [],
    });
    const vocabularyInput = {
      ...date,
      operationId: "korean-word",
      materialId: korean.id,
      sessionId: session.id,
      term: "모형",
      meaning: "Fictional model",
      context: "Fictional Korean context",
    };
    assert.throws(
      () => addReadingVocabulary(f.store, vocabularyInput),
      /explicit languages/,
    );
    upgradeBuiltinLanguages(f.store, "languages");
    const vocabulary = addReadingVocabulary(f.store, vocabularyInput);
    assert.equal(vocabulary.fields.language, "ko");
    assert.equal(vocabulary.fields.minutes, undefined);
    assert.equal(readingReport(f.store.list()).uniqueTotalMinutes, 13);
  } finally {
    f.close();
  }
});

test("basic reading needs learning alone and vocabulary explicitly requires languages to be enabled", () => {
  const f = fixture();
  try {
    f.store.setEnabled("languages", false);
    const source = material(f.store, "independent-material", "英语");
    const session = recordReading(f.store, {
      ...date,
      operationId: "independent-reading",
      materialId: source.id,
      minutes: 20,
      goalIds: [],
    });
    addReadingExplanation(f.store, {
      ...date,
      operationId: "independent-explanation",
      materialId: source.id,
      sessionId: session.id,
      text: "Fictional supporting explanation",
    });
    const before = f.store.backup();
    assert.throws(
      () =>
        addReadingVocabulary(f.store, {
          ...date,
          operationId: "disabled-language-word",
          materialId: source.id,
          sessionId: session.id,
          term: "model",
          meaning: "Synthetic meaning",
          context: "Fictional context",
        }),
      /languages module to be enabled/,
    );
    assert.deepEqual(f.store.backup(), before);
    assert.equal(readingReport(f.store.list()).uniqueTotalMinutes, 20);
  } finally {
    f.close();
  }
});

test("explicit schema 3 migration preserves custom manifests, unknown values/frontmatter, stable identities and disabled state with recovery", () => {
  const f = fixture();
  let restored: Store | undefined;
  try {
    const custom = f.store.module("learning");
    custom.name = "Custom reading";
    const fields = custom.entityTypes.find(
      (item) => item.id === "material",
    )!.fields;
    fields.find((field) => field.key === "language")!.options!.push("旧方言");
    fields.push({ key: "customValue", label: "Custom field", type: "text" });
    f.store.db
      .prepare("UPDATE modules SET json=? WHERE id=?")
      .run(JSON.stringify(custom), "learning");
    const source = f.store.save({
      expectedVersion: 0,
      entity: {
        ...date,
        module: "learning",
        type: "material",
        title: "Synthetic custom legacy history",
        kind: "fact",
        status: "done",
        fields: { language: "旧方言", customValue: "Preserved" },
        relations: [],
        body: "Original custom history\n",
      },
    });
    const note = f.store.vault.read(source.id)!.path;
    writeFileSync(
      note,
      readFileSync(note, "utf8").replace(
        "---\n",
        "---\nprivate_custom_metadata: fictional-preserved\n",
      ),
    );
    f.store.setEnabled("learning", false);
    const disabled = f.store.module("learning", false);
    disabled.codeVisibility = "private";
    f.store.db
      .prepare("UPDATE modules SET json=? WHERE id=?")
      .run(JSON.stringify(disabled), "learning");
    assert.equal(
      pendingBuiltinLanguageUpgrades(f.store).pending.find(
        (item) => item.module === "learning",
      )!.compatible,
      true,
    );
    const result = upgradeBuiltinLanguages(f.store, "learning");
    const migrated = f.store.module("learning", false);
    assert.equal(migrated.schemaVersion, 3);
    assert.equal(migrated.name, "Custom reading");
    assert.equal(migrated.enabled, false);
    assert.equal(migrated.codeVisibility, "private");
    assert.equal(
      migrated.entityTypes
        .find((item) => item.id === "material")!
        .fields.find((field) => field.key === "customValue")!.label,
      "Custom field",
    );
    const history = f.store.get(source.id)!;
    assert.equal(history.id, source.id);
    assert.equal(history.module, source.module);
    assert.equal(history.type, source.type);
    assert.equal(history.kind, source.kind);
    assert.deepEqual(history.fields, source.fields);
    assert.equal(history.body, source.body);
    assert.match(
      readFileSync(note, "utf8"),
      /private_custom_metadata: fictional-preserved/,
    );
    assert.equal(
      upgradeBuiltinLanguages(f.store, "learning").alreadyCurrent,
      true,
    );
    restored = Store.restore(
      join(f.root, "recovered"),
      JSON.parse(readFileSync(result.backup!, "utf8")),
    );
    assert.equal(restored.module("learning", false).schemaVersion, 2);
    assert.equal(restored.get(source.id)!.fields.language, "旧方言");
    assert.match(
      readFileSync(restored.vault.read(source.id)!.path, "utf8"),
      /private_custom_metadata: fictional-preserved/,
    );
  } finally {
    restored?.close();
    f.close();
  }
});

test("legacy/code reading history groups by identity, remains after stopping study and counts each session once", () => {
  const f = fixture();
  try {
    const legacy = material(f.store, "old-english", "英语");
    const first = recordReading(f.store, {
      ...date,
      operationId: "old-session",
      materialId: legacy.id,
      minutes: 10,
      goalIds: [],
    });
    upgradeBuiltinLanguages(f.store, "learning");
    const modern = material(f.store, "modern-english", "en");
    recordReading(f.store, {
      ...date,
      operationId: "modern-session",
      materialId: modern.id,
      minutes: 15,
      goalIds: [],
    });
    f.store.setEnabled("languages", false);
    validateActiveLanguageCodes([]);
    const report = readingReport([...f.store.list(), first]);
    assert.equal(report.uniqueTotalMinutes, 25);
    assert.equal(report.byLanguage.length, 1);
    assert.equal(report.byLanguage[0].language, "英语");
    assert.equal(report.byLanguage[0].minutes, 25);
    assert.equal(report.issues.length, 0);
    assert.equal(f.store.get(legacy.id)!.fields.language, "英语");
    assert.equal(f.store.get(modern.id)!.fields.language, "en");
  } finally {
    f.close();
  }
});

test("authenticated HTTP accepts an added language only after explicit schema upgrade and preserves reading time", async () => {
  const f = fixture(),
    server = app(f.store);
  const host = { host: "localhost:4310" };
  try {
    const auth = await server.inject({ url: "/api/session", headers: host });
    const headers = {
      ...host,
      cookie: String(auth.headers["set-cookie"]).split(";")[0],
      "x-csrf-token": auth.json().csrf,
    };
    const payload = {
      ...date,
      operationId: "http-korean-source",
      language: "ko",
      title: "Synthetic Korean reading",
      reference: "synthetic://korean",
      sourceType: "技术文档",
      rights: "虚构样例",
      body: "Fictional source text",
    };
    const denied = await server.inject({
      method: "POST",
      url: "/api/reading/materials",
      headers,
      payload,
    });
    assert.equal(denied.statusCode, 400);
    assert.match(denied.json().error, /explicit learning/);
    assert.equal(f.store.list().length, 0);
    const upgraded = await server.inject({
      method: "POST",
      url: "/api/languages/upgrade",
      headers,
      payload: { module: "learning" },
    });
    assert.equal(upgraded.statusCode, 200, upgraded.body);
    assert.equal(upgraded.json().toSchema, 3);
    const created = await server.inject({
      method: "POST",
      url: "/api/reading/materials",
      headers,
      payload,
    });
    assert.equal(created.statusCode, 200, created.body);
    assert.equal(created.json().fields.language, "ko");
    f.store.setEnabled("languages", false);
    const session = await server.inject({
      method: "POST",
      url: "/api/reading/sessions",
      headers,
      payload: {
        ...date,
        operationId: "http-korean-reading",
        materialId: created.json().id,
        minutes: 23,
        goalIds: [],
      },
    });
    assert.equal(session.statusCode, 200, session.body);
    const vocabulary = await server.inject({
      method: "POST",
      url: "/api/reading/vocabulary",
      headers,
      payload: {
        ...date,
        operationId: "http-korean-vocabulary",
        materialId: created.json().id,
        sessionId: session.json().id,
        term: "모형",
        meaning: "Fictional model",
        context: "Fictional context",
      },
    });
    assert.equal(vocabulary.statusCode, 400);
    assert.match(vocabulary.json().error, /languages module to be enabled/);
    const report = await server.inject({
      url: "/api/reports/reading",
      headers,
    });
    assert.equal(report.statusCode, 200);
    assert.equal(report.json().uniqueTotalMinutes, 23);
    assert.equal(report.json().byLanguage[0].language, "ko");
  } finally {
    await server.close();
    f.close();
  }
});
