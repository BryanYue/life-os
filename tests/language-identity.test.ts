import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { upgradeBuiltinLanguages } from "../src/builtin-upgrades.js";
import { languageCatalog, languageDisplayLabels } from "../src/languages.js";
import {
  createReadingMaterial,
  recordReading,
  readingReport,
} from "../src/reading.js";
import { summary } from "../src/domain.js";

test("custom names cannot collide with generated language labels", () => {
  const catalog = languageCatalog([
    { code: "ko", name: "英语" },
    { code: "de", name: "英语 (en)" },
  ]);
  const labels = languageDisplayLabels(["en", "ko", "de"], catalog);
  assert.equal(new Set(labels.values()).size, 3);
  assert.deepEqual(labels, languageDisplayLabels(["de", "ko", "en"], catalog));
  const minutes = { en: 10, ko: 20, de: 30 };
  assert.equal(
    Object.values(
      Object.fromEntries(
        Object.entries(minutes).map(([code, value]) => [
          labels.get(code)!,
          value,
        ]),
      ),
    ).reduce((sum, value) => sum + value, 0),
    60,
  );
});

test("equal display names never merge different language identities or duplicate legacy aliases", () => {
  const root = mkdtempSync(join(tmpdir(), "life-language-identity-"));
  const store = new Store(root);
  const catalog = languageCatalog([{ code: "ko", name: "英语" }]);
  const when = { occurredAt: "2030-04-01T10:00:00Z", timeZone: "UTC" };
  try {
    upgradeBuiltinLanguages(store, "learning");
    for (const [language, minutes] of [
      ["英语", 5],
      ["en", 5],
      ["ko", 20],
    ] as const) {
      const material = createReadingMaterial(store, {
        ...when,
        operationId:
          "material-" +
          minutes +
          "-" +
          (language === "英语" ? "legacy" : language),
        title: "Fictional homonym reading",
        language,
        reference: "synthetic://identity",
        sourceType: "技术文档",
        rights: "虚构样例",
        body: "Fictional text only",
      });
      recordReading(store, {
        ...when,
        materialId: material.id,
        operationId: "session-" + material.id,
        minutes,
        goalIds: [],
      });
    }
    const report = readingReport(store.list(), catalog);
    assert.equal(report.uniqueTotalMinutes, 30);
    assert.deepEqual(
      report.byLanguageCode.map(({ code, minutes }) => ({ code, minutes })),
      [
        { code: "en", minutes: 10 },
        { code: "ko", minutes: 20 },
      ],
    );
    assert.deepEqual(
      report.byLanguage.map(({ language, minutes }) => ({ language, minutes })),
      [
        { language: "英语 (en)", minutes: 10 },
        { language: "英语 (ko)", minutes: 20 },
      ],
    );
    const result = summary(store.list(), undefined, catalog);
    assert.deepEqual(result.minutesByLanguageCode, { en: 10, ko: 20 });
    assert.deepEqual(result.minutesByLanguage, {
      "英语 (en)": 10,
      "英语 (ko)": 20,
    });
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
