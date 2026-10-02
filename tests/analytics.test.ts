import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { financeReport, healthReport } from "../src/analytics.js";
import { Store } from "../src/store.js";
import { importHealth } from "../src/importers.js";
import type { Entity, EntityInput } from "../src/types.js";

function entity(
  id: string,
  type: string,
  fields: Entity["fields"],
  patch: Partial<Entity> = {},
): Entity {
  return {
    id,
    module: "finance",
    type,
    title: "Fictional " + id,
    kind: "fact",
    status: "done",
    occurredAt: "2030-04-01",
    timeZone: "UTC",
    createdAt: "2030-04-01T00:00:00Z",
    updatedAt: "2030-04-01T00:00:00Z",
    actor: "fictional-user",
    version: 1,
    schemaVersion: 1,
    source: {
      namespace: "fictional-analytics",
      recordId: id,
      revision: "1",
      mode: "manual",
    },
    fields,
    relations: [],
    body: "All data is fictional.",
    noteHash: "fictional-hash",
    deleted: false,
    ...patch,
  };
}
const account = (id: string, currency = "USD") =>
  entity(id, "account", { currency, category: "Fictional account" });
const snapshot = (
  id: string,
  target: string,
  amount: string,
  category = "资产",
  occurredAt = "2030-04-01",
  currency = "USD",
) =>
  entity(
    id,
    "snapshot",
    { amount, currency, category },
    { occurredAt, relations: [{ type: "related", target }] },
  );
const rate = (
  id: string,
  base: string,
  quote: string,
  value: string,
  date = "2030-04-01",
  occurredAt = date,
) =>
  entity(
    id,
    "rate",
    {
      base,
      quote,
      rate: value,
      date,
      reference: "Fictional published rate " + id,
    },
    { occurredAt },
  );
const metric = (
  id: string,
  value: number,
  unit = "bpm",
  measurement = "设备测量",
  patch: Partial<Entity> = {},
) =>
  entity(
    id,
    "metric",
    { metric: "heartRate", value, unit, measurement },
    { module: "health", ...patch },
  );

test("D07 exact category/currency totals preserve all source records and exclude plans, inferences and tombstones", () => {
  const entries = [
    entity("one", "entry", {
      amount: "0.1",
      currency: "USD",
      category: "Income",
    }),
    entity(
      "two",
      "entry",
      { amount: "0.2", currency: "USD", category: "Income" },
      { status: "active" },
    ),
    entity("expense", "entry", {
      amount: "-0.05",
      currency: "USD",
      category: "Expense",
    }),
    entity("large", "entry", {
      amount: "9007199254740993.00000001",
      currency: "JPY",
      category: "Income",
    }),
    entity(
      "planned",
      "entry",
      { amount: "100000", currency: "USD", category: "Income" },
      { kind: "plan" },
    ),
    entity(
      "inferred",
      "entry",
      { amount: "100000", currency: "USD", category: "Income" },
      { kind: "inference" },
    ),
    entity(
      "deleted",
      "entry",
      { amount: "100000", currency: "USD", category: "Income" },
      { deleted: true },
    ),
  ];
  const before = JSON.stringify(entries);
  const report = financeReport(entries);
  assert.deepEqual(
    report.entryTotals.map(({ currency, total }) => ({ currency, total })),
    [
      { currency: "JPY", total: "9007199254740993.00000001" },
      { currency: "USD", total: "0.25" },
    ],
  );
  const income = report.entries.find(
    (group) => group.currency === "USD" && group.category === "Income",
  )!;
  assert.equal(income.total, "0.3");
  assert.deepEqual(
    income.records.map((record) => record.evidence.entityId),
    ["one", "two"],
  );
  assert.equal(income.records[1].evidence.status, "active");
  assert.deepEqual(income.records[0].evidence.source, entries[0].source);
  assert.equal(income.records[0].evidence.timeZone, "UTC");
  assert.equal(JSON.stringify(entries), before);
  assert.doesNotThrow(() => JSON.stringify(report));
});

test("D07 linked account balance history carries the latest snapshot instead of summing balances", () => {
  const rows = [
    account("cash"),
    account("debt"),
    account("euro", "EUR"),
    snapshot("cash-day-one", "cash", "100.1"),
    snapshot("debt-day-one", "debt", "20.01", "负债"),
    snapshot("euro-day-one", "euro", "10", "资产", "2030-04-01", "EUR"),
    snapshot("cash-day-two", "cash", "120.2", "资产", "2030-04-02"),
    snapshot("future-cash", "cash", "999", "资产", "2030-04-03"),
    snapshot("planned-cash", "cash", "999", "资产", "2030-04-02"),
  ];
  rows.at(-1)!.kind = "plan";
  const report = financeReport(rows.reverse(), { asOf: "2030-04-02" });
  assert.deepEqual(
    report.snapshotHistory.map((point) => point.date),
    ["2030-04-01", "2030-04-02"],
  );
  assert.equal(
    report.snapshotHistory[0].totals.find((row) => row.currency === "USD")!
      .netWorth,
    "80.09",
  );
  assert.deepEqual(
    report.latest!.totals.find((row) => row.currency === "USD"),
    {
      currency: "USD",
      assets: "120.2",
      liabilities: "20.01",
      netWorth: "100.19",
      entityIds: ["cash-day-two", "debt-day-one"],
    },
  );
  assert.equal(
    report.latest!.accounts.find((row) => row.accountId === "cash")!.account
      .entityId,
    "cash",
  );
  assert.equal(report.latest!.accounts.length, 3);
  assert.equal(report.latest!.complete, true);
});

test("D07 rate conversion is exact with dated source evidence and changes as-of valuation", () => {
  const rows = [
    account("euro", "EUR"),
    account("debt"),
    snapshot("euro-balance", "euro", "0.12345678", "资产", "2030-04-01", "EUR"),
    snapshot("debt-balance", "debt", "0.01", "负债"),
    rate("first-rate", "EUR", "USD", "1.12345678"),
    rate("second-rate", "EUR", "USD", "2", "2030-04-02"),
  ];
  const initial = financeReport(rows, { quoteCurrency: "USD" }).latest!
    .conversion!;
  assert.equal(initial.total, "0.1286983565279684");
  assert.equal(initial.complete, true);
  const foreign = initial.lines.find(
    (line) => line.entityId === "euro-balance",
  )!;
  assert.equal(foreign.rate!.evidence.entityId, "first-rate");
  assert.equal(foreign.rate!.date, "2030-04-01");
  assert.equal(foreign.rate!.rate, "1.12345678");
  assert.equal(foreign.rate!.reference, "Fictional published rate first-rate");
  assert.equal(foreign.rate!.evidence.source.namespace, "fictional-analytics");
  const later = financeReport(rows, {
    quoteCurrency: "USD",
    asOf: "2030-04-02",
  });
  assert.equal(later.latest!.conversion!.total, "0.23691356");
  assert.equal(later.snapshotHistory[0].conversion!.total, initial.total);
  assert.doesNotThrow(() => JSON.stringify(later));
});

test("D07 missing direct exchange rates produce no combined total and never infer reciprocal rates", () => {
  const rows = [
    account("cash"),
    account("yen", "JPY"),
    snapshot("cash", "cash", "10"),
    snapshot("yen", "yen", "100", "资产", "2030-04-01", "JPY"),
    rate("inverse", "USD", "JPY", "100"),
  ];
  const conversion = financeReport(rows, { quoteCurrency: "USD" }).latest!
    .conversion!;
  assert.equal(conversion.complete, false);
  assert.equal(conversion.total, null);
  assert.equal(conversion.partialTotal, "10");
  assert.deepEqual(conversion.missingEntityIds, ["yen"]);
  assert.equal(
    conversion.lines.find((line) => line.entityId === "yen")!.reason,
    "missing-rate",
  );
});

test("D07 future effective rates, future recorded rates and plan rates cannot value earlier facts", () => {
  const rows = [
    account("euro", "EUR"),
    snapshot("balance", "euro", "10", "资产", "2030-04-01", "EUR"),
    rate("future-effective", "EUR", "USD", "8", "2030-04-02", "2030-04-01"),
    rate("future-recorded", "EUR", "USD", "9", "2030-04-01", "2030-04-02"),
    rate("planned", "EUR", "USD", "10"),
  ];
  rows.at(-1)!.kind = "plan";
  assert.equal(
    financeReport(rows, { quoteCurrency: "USD" }).latest!.conversion!.total,
    null,
  );
  assert.equal(
    financeReport(rows, { quoteCurrency: "USD", asOf: "2030-04-01" }).latest!
      .conversion!.total,
    null,
  );
});

test("D07 intraday as-of and offset timestamps reject later balances and later rates", () => {
  const rows = [
    account("euro", "EUR"),
    snapshot(
      "morning",
      "euro",
      "10",
      "资产",
      "2030-04-01T08:00:00+02:00",
      "EUR",
    ),
    snapshot("afternoon", "euro", "20", "资产", "2030-04-01T14:00:00Z", "EUR"),
    rate(
      "morning-rate",
      "EUR",
      "USD",
      "2",
      "2030-04-01",
      "2030-04-01T07:00:00Z",
    ),
    rate("late-rate", "EUR", "USD", "3", "2030-04-01", "2030-04-01T11:00:00Z"),
  ];
  const report = financeReport(rows, {
    quoteCurrency: "USD",
    asOf: "2030-04-01T10:00:00Z",
  });
  assert.equal(report.latest!.totals[0].assets, "10");
  assert.equal(report.latest!.conversion!.total, "20");
  assert.equal(report.snapshotHistory[0].conversion!.total, "20");
});

test("D07 historical entries use rates at their event time rather than later valuation rates", () => {
  const report = financeReport(
    [
      entity("income", "entry", {
        amount: "-0.1",
        currency: "EUR",
        category: "Expense",
      }),
      rate("first", "EUR", "USD", "1.5"),
      rate("later", "EUR", "USD", "9", "2030-04-02"),
    ],
    { quoteCurrency: "USD", asOf: "2030-04-02" },
  );
  assert.equal(report.entryConversion!.total, "-0.15");
  assert.equal(
    report.entryConversion!.lines[0].rate!.evidence.entityId,
    "first",
  );
});

test("D07 ambiguous, missing, mismatched and negative account snapshots visibly prevent a complete net worth", () => {
  const ambiguous = snapshot("ambiguous", "one", "100");
  ambiguous.relations.push({ type: "related", target: "two" });
  const rows = [
    account("one"),
    account("two"),
    snapshot("valid", "one", "10"),
    ambiguous,
    snapshot("missing", "absent", "100"),
    snapshot("mismatch", "one", "100", "资产", "2030-04-01", "EUR"),
    snapshot("negative", "two", "-100"),
  ];
  const report = financeReport(rows, { quoteCurrency: "USD" });
  assert.equal(report.latest!.accounts.length, 1);
  assert.equal(report.latest!.totals[0].netWorth, "10");
  assert.equal(report.latest!.complete, false);
  assert.equal(report.latest!.conversion!.total, null);
  assert.deepEqual(report.issues.map((issue) => issue.entityId).sort(), [
    "ambiguous",
    "mismatch",
    "missing",
    "negative",
  ]);
});

test("D07 invalid values never coerce amounts through floating point and invalid options fail clearly", () => {
  const report = financeReport([
    entity("numeric", "entry", {
      amount: 0.1,
      currency: "USD",
      category: "Expense",
    }),
    rate("zero", "EUR", "USD", "0"),
    rate("invalid-date", "EUR", "USD", "2", "2030-02-30"),
  ]);
  assert.equal(report.entries.length, 0);
  assert.equal(report.issues.length, 3);
  assert.throws(() => financeReport([], { asOf: "2030-02-30" }), /calendar/);
  assert.throws(
    () => financeReport([], { quoteCurrency: "" }),
    /quoteCurrency/,
  );
});

test("D02 trends keep subjective/device, metric/unit, source, lifecycle and temporal ordering distinct", () => {
  const rows = [
    metric("device-second", 65, "bpm", "设备测量", {
      occurredAt: "2030-04-02",
      status: "active",
    }),
    metric("subjective", 8, "bpm", "主观自评"),
    metric("device-first", 60, "bpm", "设备测量", { status: "draft" }),
    metric("other-unit", 1, "Hz"),
    metric("planned", 999, "bpm", "设备测量", { kind: "plan" }),
    metric("inference", 999, "bpm", "设备测量", { kind: "inference" }),
    metric("deleted", 999, "bpm", "设备测量", { deleted: true }),
  ];
  const report = healthReport(rows);
  assert.equal(report.trends.length, 3);
  const device = report.trends.find(
    (trend) => trend.measurement === "设备测量" && trend.unit === "bpm",
  )!;
  assert.deepEqual(
    device.points.map((point) => [point.value, point.evidence.status]),
    [
      [60, "draft"],
      [65, "active"],
    ],
  );
  assert.equal(device.change, 5);
  assert.equal(device.points[0].evidence.entityId, "device-first");
  assert.equal(
    report.trends.find((trend) => trend.unit === "Hz")!.change,
    null,
  );
  assert.equal(report.trends.flatMap((trend) => trend.points).length, 4);
  assert.doesNotThrow(() => JSON.stringify(report));
});

test("D02 actual-of compares unit-compatible facts, records lifecycle and does not count planned or inferred activity", () => {
  const plan = metric("plan", 60, "bpm", "设备测量", {
    kind: "plan",
    status: "active",
  });
  const relates = [
    { type: "actual-of", target: plan.id },
    { type: "actual-of", target: plan.id },
  ];
  const report = healthReport([
    plan,
    metric("completed", 62, "bpm", "设备测量", { relations: relates }),
    metric("recorded", 65, "bpm", "设备测量", {
      relations: relates,
      status: "active",
    }),
    metric("other-unit", 1, "Hz", "设备测量", { relations: relates }),
    metric("suggested", 999, "bpm", "设备测量", {
      relations: relates,
      kind: "inference",
    }),
    metric("planned-actual", 999, "bpm", "设备测量", {
      relations: relates,
      kind: "plan",
    }),
  ]);
  const comparison = report.plans.find((row) => row.plan.entityId === plan.id)!;
  assert.equal(comparison.recordedCount, 3);
  assert.equal(comparison.completedCount, 2);
  const bpm = comparison.comparisons.find((row) => row.unit === "bpm")!;
  assert.equal(bpm.plannedTotal, 60);
  assert.equal(bpm.recordedTotal, 127);
  assert.equal(bpm.completedTotal, 62);
  assert.equal(bpm.completedDifference, 2);
  assert.equal(bpm.measurements[0].recordedTotal, 127);
  const hz = comparison.comparisons.find((row) => row.unit === "Hz")!;
  assert.equal(hz.plannedTotal, null);
  assert.equal(hz.completedDifference, null);
  assert.deepEqual(
    report.trends
      .flatMap((trend) => trend.points.map((point) => point.evidence.entityId))
      .sort(),
    ["completed", "other-unit", "recorded"],
  );
});

test("D02 session duration and subjective effort keep distinct measures and incomplete plans show the missing work", () => {
  const plan = entity(
    "walk-plan",
    "session",
    { activity: "Fictional walk", minutes: 30, measurement: "设备测量" },
    { module: "health", kind: "plan" },
  );
  const actual = entity(
    "walk",
    "session",
    {
      activity: "Fictional walk",
      minutes: 20,
      effort: 3,
      measurement: "设备测量",
    },
    { module: "health", relations: [{ type: "actual-of", target: plan.id }] },
  );
  const report = healthReport([
    plan,
    actual,
    metric("orphan", 60, "bpm", "设备测量", {
      relations: [{ type: "actual-of", target: "missing" }],
    }),
  ]);
  assert.equal(
    report.plans[0].comparisons.find((row) => row.metric === "duration")!
      .completedDifference,
    -10,
  );
  assert.equal(
    report.trends.find((trend) => trend.metric === "effort")!.measurement,
    "主观自评",
  );
  assert.deepEqual(report.unlinkedActualEntityIds, ["orphan"]);
  assert.equal(report.issues[0].code, "missing-health-plan");
  const empty = healthReport([plan]);
  assert.equal(empty.plans[0].comparisons[0].completedDifference, -30);
  assert.equal(empty.trends.length, 0);
});

test("D02 invalid measurement data is reported instead of silently discarded", () => {
  const report = healthReport([
    metric("nan", NaN),
    metric("unknown-method", 60, "bpm", "unknown"),
  ]);
  assert.equal(report.trends.length, 0);
  assert.deepEqual(report.issues.map((issue) => issue.entityId).sort(), [
    "nan",
    "unknown-method",
  ]);
});

test("D02 reviews and goal facts do not become completed health activity", () => {
  const plan = metric("target", 60, "bpm", "设备测量", { kind: "plan" });
  const related = {
    module: "health",
    relations: [{ type: "actual-of", target: plan.id }],
  };
  const report = healthReport([
    plan,
    entity("review", "review", { feeling: "Fictional reflection" }, related),
    entity("goal", "goal", { measure: "Fictional goal" }, related),
  ]);
  assert.equal(report.plans[0].recordedCount, 0);
  assert.equal(report.plans[0].completedCount, 0);
  assert.equal(report.trends.length, 0);
  assert.deepEqual(report.unlinkedActualEntityIds, []);
});

test("D07 invalid entry prevents a misleading complete converted income total", () => {
  const report = financeReport(
    [
      entity("valid", "entry", {
        amount: "1",
        currency: "USD",
        category: "Income",
      }),
      entity("invalid", "entry", {
        amount: 0.1,
        currency: "USD",
        category: "Income",
      }),
    ],
    { quoteCurrency: "USD" },
  );
  assert.equal(report.entryConversion!.partialTotal, "1");
  assert.equal(report.entryConversion!.total, null);
  assert.equal(report.entryConversion!.complete, false);
  assert.equal(report.issues[0].entityId, "invalid");
});

test("D02 ambiguous actual-of facts stay in trends but never complete either health plan", () => {
  const first = metric("first-plan", 60, "bpm", "设备测量", { kind: "plan" });
  const second = metric("second-plan", 65, "bpm", "设备测量", { kind: "plan" });
  const ambiguous = metric("ambiguous-actual", 62, "bpm", "设备测量", {
    relations: [
      { type: "actual-of", target: first.id },
      { type: "actual-of", target: second.id },
      { type: "actual-of", target: first.id },
    ],
  });
  const report = healthReport([first, second, ambiguous]);
  assert.equal(report.trends[0].points.length, 1);
  assert.equal(report.trends[0].points[0].evidence.entityId, ambiguous.id);
  for (const plan of report.plans) {
    assert.equal(plan.recordedCount, 0);
    assert.equal(plan.completedCount, 0);
    assert.deepEqual(plan.actuals, []);
    assert.equal(plan.comparisons[0].recordedTotal, 0);
    assert.equal(plan.comparisons[0].completedTotal, 0);
  }
  const issue = report.issues.find((issue) => issue.entityId === ambiguous.id)!;
  assert.equal(issue.code, "ambiguous-health-plan");
  assert.match(issue.message, /first-plan/);
  assert.match(issue.message, /second-plan/);
});

test("D02 all actual-of targets participate in ambiguity checks, including unavailable and other-domain plans", () => {
  const plan = metric("health-plan", 60, "bpm", "设备测量", { kind: "plan" });
  const otherPlan = entity(
    "learning-plan",
    "goal",
    {},
    { module: "learning", kind: "plan" },
  );
  const ambiguous = metric("cross-domain-actual", 62, "bpm", "设备测量", {
    relations: [
      { type: "actual-of", target: plan.id },
      { type: "actual-of", target: otherPlan.id },
    ],
  });
  const missing = metric("missing-target-actual", 63, "bpm", "设备测量", {
    relations: [
      { type: "actual-of", target: plan.id },
      { type: "actual-of", target: "missing-target" },
    ],
  });
  const valid = metric("unique-actual", 64, "bpm", "设备测量", {
    relations: [
      { type: "actual-of", target: plan.id },
      { type: "actual-of", target: plan.id },
    ],
  });
  const report = healthReport([plan, otherPlan, ambiguous, missing, valid]);
  assert.equal(report.trends[0].points.length, 3);
  assert.equal(report.plans[0].recordedCount, 1);
  assert.equal(report.plans[0].completedCount, 1);
  assert.equal(report.plans[0].comparisons[0].completedTotal, 64);
  assert.deepEqual(
    report.plans[0].actuals.map((actual) => actual.entityId),
    [valid.id],
  );
  assert.deepEqual(
    report.issues
      .filter((issue) => issue.code === "ambiguous-health-plan")
      .map((issue) => issue.entityId)
      .sort(),
    [ambiguous.id, missing.id].sort(),
  );
  assert.equal(
    report.issues.filter((issue) => issue.code === "missing-health-plan")
      .length,
    2,
  );
});

test("D02/D07 local workflow survives edit, synthetic source revision, duplicate import, restart and backup restore", () => {
  const root = mkdtempSync(join(tmpdir(), "fictional-analytics-"));
  let store = new Store(join(root, "original"));
  let restored: Store | undefined;
  const save = (value: Entity) =>
    store.save({ entity: value as EntityInput, expectedVersion: 0 });
  try {
    const cash = save(account("fictional-cash"));
    const debt = save(account("fictional-debt"));
    save(snapshot("fictional-balance", cash.id, "100.10"));
    save(snapshot("fictional-liability", debt.id, "20.01", "负债"));
    const next = save(
      snapshot(
        "fictional-next-balance",
        cash.id,
        "110.20",
        "资产",
        "2030-04-02",
      ),
    );
    store.save({
      entity: { ...next, fields: { ...next.fields, amount: "120.20" } },
      expectedVersion: next.version,
      expectedNoteHash: next.noteHash,
    });
    const plan = save(
      entity(
        "fictional-plan",
        "session",
        { activity: "Fictional walk", minutes: 30, measurement: "设备测量" },
        { module: "health", kind: "plan", status: "active" },
      ),
    );
    const exportData = {
      format: "life-os-health-v1" as const,
      synthetic: true,
      samples: [
        {
          id: "fictional-device-duration",
          revision: "1",
          metric: "duration" as const,
          value: 20,
          unit: "min" as const,
          start: "2030-04-01T08:00:00Z",
          timeZone: "UTC",
        },
      ],
    };
    importHealth(store, exportData);
    importHealth(store, exportData);
    const imported = store
      .list({ module: "health" })
      .find((row) => row.kind === "fact")!;
    store.save({
      entity: {
        ...imported,
        relations: [{ type: "actual-of", target: plan.id }],
      },
      expectedVersion: imported.version,
      expectedNoteHash: imported.noteHash,
    });
    exportData.samples[0] = {
      ...exportData.samples[0],
      revision: "2",
      value: 25,
    };
    importHealth(store, exportData);
    const revised = store.get(imported.id)!;
    // The importer owns its source fields; explicitly reconnect the revised fact to the plan.
    store.save({
      entity: {
        ...revised,
        relations: [{ type: "actual-of", target: plan.id }],
      },
      expectedVersion: revised.version,
      expectedNoteHash: revised.noteHash,
    });
    const finance = financeReport(store.list());
    const health = healthReport(store.list());
    assert.equal(finance.latest!.totals[0].netWorth, "100.19");
    assert.equal(health.trends[0].points.length, 1);
    assert.equal(health.trends[0].points[0].value, 25);
    assert.equal(health.trends[0].points[0].evidence.entityId, imported.id);
    assert.equal(health.trends[0].points[0].evidence.source.revision, "2");
    assert.equal(health.plans[0].comparisons[0].completedDifference, -5);
    const backup = store.backup();
    store.close();
    store = new Store(join(root, "original"));
    assert.deepEqual(financeReport(store.list()), finance);
    assert.deepEqual(healthReport(store.list()), health);
    restored = Store.restore(join(root, "restored"), backup);
    assert.deepEqual(financeReport(restored.list()), finance);
    assert.deepEqual(healthReport(restored.list()), health);
  } finally {
    store.close();
    restored?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
