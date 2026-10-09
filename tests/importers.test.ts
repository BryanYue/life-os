import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import {
  parseHealthExport,
  importHealth,
  type HealthExport,
} from "../src/importers.js";
test("A01 synthetic health export: units/timezone, duplicate and source revision/error", () => {
  const root = mkdtempSync(join(tmpdir(), "life-health-")),
    s = new Store(root);
  try {
    const data = JSON.parse(
      readFileSync("examples/health-export.json", "utf8"),
    ) as HealthExport;
    const first = importHealth(s, data)[0];
    assert.equal(first.timeZone, "Asia/Tokyo");
    assert.equal(first.occurredAt, "2030-04-01T10:00:00+09:00");
    assert.equal(importHealth(s, data)[0].id, first.id);
    const changed = structuredClone(data);
    changed.samples[0].revision = "2";
    changed.samples[0].value = 15;
    assert.equal(importHealth(s, changed)[0].version, 2);
    assert.equal(importHealth(s, data)[0].fields.value, 15);
    const invalid = structuredClone(data);
    invalid.samples[0].unit = "bpm";
    assert.throws(() => parseHealthExport(invalid), /index 0/);
    assert.equal(s.list().length, 1);
  } finally {
    s.close();
    rmSync(root, { recursive: true, force: true });
  }
});
