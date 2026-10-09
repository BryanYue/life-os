import type { Entity, Source } from "./types.js";

export type Evidence = {
  entityId: string;
  source: Source;
  occurredAt: string;
  timeZone: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  status: Entity["status"];
};
export type AnalyticsIssue = {
  entityId: string;
  code: string;
  message: string;
};
type Decimal = { coefficient: bigint; scale: number };

// Variable scale keeps products exact, including all digits in an exchange rate.
function decimal(value: unknown): Decimal {
  if (typeof value !== "string" || !/^-?\d+(\.\d+)?$/.test(value))
    throw Error("Expected an exact decimal string");
  const [whole, fraction = ""] = value.split(".");
  return { coefficient: BigInt(whole + fraction), scale: fraction.length };
}
function decimalText(value: Decimal): string {
  const negative = value.coefficient < 0n;
  const digits = (negative ? -value.coefficient : value.coefficient)
    .toString()
    .padStart(value.scale + 1, "0");
  const whole = value.scale ? digits.slice(0, -value.scale) : digits;
  const fraction = value.scale
    ? digits.slice(-value.scale).replace(/0+$/, "")
    : "";
  return (negative ? "-" : "") + whole + (fraction ? "." + fraction : "");
}
function plus(a: string, b: string): string {
  const x = decimal(a),
    y = decimal(b),
    scale = Math.max(x.scale, y.scale);
  return decimalText({
    coefficient:
      x.coefficient * 10n ** BigInt(scale - x.scale) +
      y.coefficient * 10n ** BigInt(scale - y.scale),
    scale,
  });
}
function negative(value: string): string {
  const d = decimal(value);
  return decimalText({ ...d, coefficient: -d.coefficient });
}
function multiply(a: string, b: string): string {
  const x = decimal(a),
    y = decimal(b);
  return decimalText({
    coefficient: x.coefficient * y.coefficient,
    scale: x.scale + y.scale,
  });
}
function evidence(entity: Entity): Evidence {
  return {
    entityId: entity.id,
    source: { ...entity.source },
    occurredAt: entity.occurredAt,
    timeZone: entity.timeZone,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    version: entity.version,
    status: entity.status,
  };
}
function textField(entity: Entity, key: string): string {
  const value = entity.fields[key];
  if (typeof value !== "string" || !value.trim()) throw Error("Missing " + key);
  return value;
}
function instant(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}(T.*(?:Z|[+-]\d{2}:\d{2}))?$/.test(value))
    throw Error("Expected ISO date or offset-aware timestamp");
  const at = Date.parse(value);
  if (
    !Number.isFinite(at) ||
    new Date(Date.parse(value.slice(0, 10))).toISOString().slice(0, 10) !==
      value.slice(0, 10)
  )
    throw Error("Invalid calendar date");
  return at;
}
function cutoff(value: string): number {
  return instant(value) + (value.length === 10 ? 86_400_000 - 1 : 0);
}
function day(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}
function compareEntities(a: Entity, b: Entity): number {
  return (
    instant(a.occurredAt) - instant(b.occurredAt) ||
    a.updatedAt.localeCompare(b.updatedAt) ||
    a.version - b.version ||
    a.id.localeCompare(b.id)
  );
}
function addIssue(
  issues: AnalyticsIssue[],
  entity: Entity,
  code: string,
  message: string,
) {
  issues.push({ entityId: entity.id, code, message });
}
type MoneyRecord = { currency: string; amount: string; evidence: Evidence };
type Rate = {
  entity: Entity;
  base: string;
  quote: string;
  rate: string;
  date: string;
  reference: string;
};
export type Conversion = {
  quoteCurrency: string;
  complete: boolean;
  total: string | null;
  partialTotal: string;
  missingEntityIds: string[];
  lines: {
    entityId: string;
    currency: string;
    amount: string;
    valuedAt: string;
    convertedAmount: string | null;
    rate: {
      rate: string;
      date: string;
      reference: string;
      evidence: Evidence;
    } | null;
    reason: "same-currency" | "explicit-rate" | "missing-rate";
  }[];
};
function convert(
  records: (MoneyRecord & { valuedAt: string })[],
  quoteCurrency: string,
  rates: Rate[],
): Conversion {
  let partialTotal = "0";
  const missingEntityIds: string[] = [];
  const lines = records.map((record) => {
    const at = cutoff(record.valuedAt);
    const selected = rates
      .filter(
        (rate) =>
          rate.base === record.currency &&
          rate.quote === quoteCurrency &&
          rate.date <= day(at) &&
          instant(rate.entity.occurredAt) <= at,
      )
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) || compareEntities(a.entity, b.entity),
      )
      .at(-1);
    const same = record.currency === quoteCurrency;
    const convertedAmount = same
      ? record.amount
      : selected
        ? multiply(record.amount, selected.rate)
        : null;
    if (convertedAmount === null)
      missingEntityIds.push(record.evidence.entityId);
    else partialTotal = plus(partialTotal, convertedAmount);
    return {
      entityId: record.evidence.entityId,
      currency: record.currency,
      amount: record.amount,
      valuedAt: record.valuedAt,
      convertedAmount,
      rate:
        same || !selected
          ? null
          : {
              rate: selected.rate,
              date: selected.date,
              reference: selected.reference,
              evidence: evidence(selected.entity),
            },
      reason: same
        ? ("same-currency" as const)
        : selected
          ? ("explicit-rate" as const)
          : ("missing-rate" as const),
    };
  });
  return {
    quoteCurrency,
    complete: missingEntityIds.length === 0,
    total: missingEntityIds.length ? null : partialTotal,
    partialTotal,
    missingEntityIds,
    lines,
  };
}
type AccountSnapshot = MoneyRecord & {
  accountId: string;
  account: Evidence;
  accountTitle: string;
  accountCategory: string;
  category: "资产" | "负债";
};
export type NetWorthPoint = {
  date: string;
  complete: boolean;
  accounts: AccountSnapshot[];
  totals: {
    currency: string;
    assets: string;
    liabilities: string;
    netWorth: string;
    entityIds: string[];
  }[];
  conversion?: Conversion;
};
export type FinanceReport = {
  asOf: string | null;
  entries: {
    currency: string;
    category: string;
    total: string;
    records: MoneyRecord[];
  }[];
  entryTotals: { currency: string; total: string; entityIds: string[] }[];
  entryConversion?: Conversion;
  snapshotHistory: NetWorthPoint[];
  latest: NetWorthPoint | null;
  issues: AnalyticsIssue[];
};

/** Local descriptive accounting only. Rates are direct, explicitly recorded pairs. */
export function financeReport(
  entities: Entity[],
  options: { quoteCurrency?: string; asOf?: string } = {},
): FinanceReport {
  if (options.quoteCurrency !== undefined && !options.quoteCurrency.trim())
    throw Error("Empty quoteCurrency");
  const asOfCutoff =
    options.asOf === undefined ? Infinity : cutoff(options.asOf);
  const issues: AnalyticsIssue[] = [];
  const finance = entities.filter(
    (entity) => !entity.deleted && entity.module === "finance",
  );
  const accounts = new Map(
    finance
      .filter(
        (entity) => entity.type === "account" && entity.kind !== "inference",
      )
      .map((entity) => [entity.id, entity]),
  );
  const facts = finance
    .filter(
      (entity) =>
        entity.kind === "fact" &&
        ["entry", "snapshot", "rate"].includes(entity.type),
    )
    .filter((entity) => {
      try {
        return instant(entity.occurredAt) <= asOfCutoff;
      } catch (error) {
        addIssue(issues, entity, "invalid-date", String(error));
        return false;
      }
    });
  const rates: Rate[] = [];
  const entries: {
    currency: string;
    category: string;
    total: string;
    records: MoneyRecord[];
  }[] = [];
  const snapshots: (AccountSnapshot & { entity: Entity })[] = [];
  const invalidSnapshots: Entity[] = [];
  for (const entity of facts.sort(compareEntities)) {
    try {
      if (entity.type === "rate") {
        const rate = decimalText(decimal(entity.fields.rate));
        if (decimal(rate).coefficient <= 0n)
          throw Error("Exchange rate must be positive");
        const date = textField(entity, "date");
        if (date.length !== 10)
          throw Error("Exchange rate date must be a calendar date");
        instant(date);
        rates.push({
          entity,
          base: textField(entity, "base"),
          quote: textField(entity, "quote"),
          rate,
          date,
          reference: textField(entity, "reference"),
        });
        continue;
      }
      const record = {
        currency: textField(entity, "currency"),
        amount: decimalText(decimal(entity.fields.amount)),
        evidence: evidence(entity),
      };
      const category = textField(entity, "category");
      if (entity.type === "entry") {
        let group = entries.find(
          (group) =>
            group.currency === record.currency && group.category === category,
        );
        if (!group) {
          group = {
            currency: record.currency,
            category,
            total: "0",
            records: [],
          };
          entries.push(group);
        }
        group.total = plus(group.total, record.amount);
        group.records.push(record);
      } else {
        const linked = [
          ...new Set(
            entity.relations
              .map((relation) => relation.target)
              .filter((target) => accounts.has(target)),
          ),
        ];
        if (linked.length !== 1)
          throw Error("Snapshot must link exactly one finance account");
        const account = accounts.get(linked[0])!;
        if (textField(account, "currency") !== record.currency)
          throw Error("Snapshot currency differs from its account currency");
        if (category !== "资产" && category !== "负债")
          throw Error("Unknown asset/liability category");
        if (decimal(record.amount).coefficient < 0n)
          throw Error(
            "Snapshot balances must be nonnegative; category determines liability sign",
          );
        snapshots.push({
          ...record,
          category,
          accountId: account.id,
          account: evidence(account),
          accountTitle: account.title,
          accountCategory: textField(account, "category"),
          entity,
        });
      }
    } catch (error) {
      addIssue(issues, entity, "invalid-" + entity.type, String(error));
      if (entity.type === "snapshot") invalidSnapshots.push(entity);
    }
  }
  const point = (date: string): NetWorthPoint => {
    const at = cutoff(date);
    const latestAccounts = new Map<string, AccountSnapshot>();
    for (const snapshot of snapshots) {
      if (instant(snapshot.entity.occurredAt) > at) continue;
      // A balance is a state per account, rather than a sum of its historical snapshots.
      const { entity: _entity, ...record } = snapshot;
      void _entity;
      latestAccounts.set(snapshot.accountId, record);
    }
    const accountRows = [...latestAccounts.values()].sort((a, b) =>
      a.accountId.localeCompare(b.accountId),
    );
    const totals: NetWorthPoint["totals"] = [];
    for (const record of accountRows) {
      let total = totals.find((total) => total.currency === record.currency);
      if (!total) {
        total = {
          currency: record.currency,
          assets: "0",
          liabilities: "0",
          netWorth: "0",
          entityIds: [],
        };
        totals.push(total);
      }
      if (record.category === "资产")
        total.assets = plus(total.assets, record.amount);
      else total.liabilities = plus(total.liabilities, record.amount);
      total.netWorth = plus(total.assets, negative(total.liabilities));
      total.entityIds.push(record.evidence.entityId);
    }
    const complete = !invalidSnapshots.some(
      (entity) => instant(entity.occurredAt) <= at,
    );
    const result: NetWorthPoint = {
      date,
      complete,
      accounts: accountRows,
      totals: totals.sort((a, b) => a.currency.localeCompare(b.currency)),
    };
    if (options.quoteCurrency) {
      result.conversion = convert(
        accountRows.map((record) => ({
          ...record,
          amount:
            record.category === "负债"
              ? negative(record.amount)
              : record.amount,
          valuedAt: date,
        })),
        options.quoteCurrency,
        rates,
      );
      if (!complete) {
        result.conversion.complete = false;
        result.conversion.total = null;
      }
    }
    return result;
  };
  const historyDates = [
    ...new Set(
      facts
        .filter((entity) => entity.type === "snapshot")
        .map((entity) => day(instant(entity.occurredAt))),
    ),
  ].sort();
  const snapshotHistory = historyDates.map((date) =>
    point(options.asOf && day(asOfCutoff) === date ? options.asOf : date),
  );
  const asOf = options.asOf ?? facts.at(-1)?.occurredAt ?? null;
  const latest =
    snapshots.length || invalidSnapshots.length
      ? point(options.asOf ?? historyDates.at(-1)!)
      : null;
  const entryTotals: FinanceReport["entryTotals"] = [];
  for (const group of entries) {
    let total = entryTotals.find((total) => total.currency === group.currency);
    if (!total) {
      total = { currency: group.currency, total: "0", entityIds: [] };
      entryTotals.push(total);
    }
    total.total = plus(total.total, group.total);
    total.entityIds.push(
      ...group.records.map((record) => record.evidence.entityId),
    );
  }
  const result: FinanceReport = {
    asOf,
    entries: entries.sort(
      (a, b) =>
        a.currency.localeCompare(b.currency) ||
        a.category.localeCompare(b.category),
    ),
    entryTotals: entryTotals.sort((a, b) =>
      a.currency.localeCompare(b.currency),
    ),
    snapshotHistory,
    latest,
    issues,
  };
  if (options.quoteCurrency) {
    result.entryConversion = convert(
      entries.flatMap((group) =>
        group.records.map((record) => ({
          ...record,
          valuedAt: record.evidence.occurredAt,
        })),
      ),
      options.quoteCurrency,
      rates,
    );
    if (issues.some((issue) => issue.code === "invalid-entry")) {
      result.entryConversion.complete = false;
      result.entryConversion.total = null;
    }
  }
  return result;
}

type Observation = {
  metric: string;
  unit: string;
  measurement: string;
  value: number;
};
export type HealthPoint = Observation & { evidence: Evidence };
export type HealthReport = {
  trends: {
    measurement: string;
    metric: string;
    unit: string;
    points: HealthPoint[];
    change: number | null;
  }[];
  plans: {
    plan: Evidence;
    title: string;
    actuals: Evidence[];
    recordedCount: number;
    completedCount: number;
    comparisons: {
      metric: string;
      unit: string;
      plannedTotal: number | null;
      recordedTotal: number;
      completedTotal: number;
      completedDifference: number | null;
      actualEntityIds: string[];
      measurements: {
        measurement: string;
        recordedTotal: number;
        completedTotal: number;
        entityIds: string[];
      }[];
    }[];
  }[];
  unlinkedActualEntityIds: string[];
  issues: AnalyticsIssue[];
};
function observations(entity: Entity): Observation[] {
  const measurement = textField(entity, "measurement");
  if (measurement !== "主观自评" && measurement !== "设备测量")
    throw Error("Unknown measurement method");
  const result: Observation[] = [];
  const add = (
    metric: string,
    unit: string,
    raw: unknown,
    mode = measurement,
  ) => {
    if (typeof raw !== "number" || !Number.isFinite(raw))
      throw Error("Expected finite numeric health value");
    result.push({ metric, unit, measurement: mode, value: raw });
  };
  if (entity.type === "metric")
    add(
      textField(entity, "metric"),
      textField(entity, "unit"),
      entity.fields.value,
    );
  if (entity.type === "session") {
    if (entity.fields.minutes !== undefined)
      add("duration", "min", entity.fields.minutes);
    if (entity.fields.effort !== undefined)
      add("effort", "score/10", entity.fields.effort, "主观自评");
    if (entity.fields.value !== undefined)
      add(
        textField(entity, "activity"),
        textField(entity, "unit"),
        entity.fields.value,
      );
  }
  return result;
}

/** Descriptive observations and completion comparisons; no medical recommendations. */
export function healthReport(entities: Entity[]): HealthReport {
  const issues: AnalyticsIssue[] = [];
  const health = entities.filter(
    (entity) => !entity.deleted && entity.module === "health",
  );
  const values = new Map<string, Observation[]>();
  const valid = health
    .filter((entity) => {
      try {
        instant(entity.occurredAt);
        if (["metric", "session"].includes(entity.type))
          values.set(entity.id, observations(entity));
        return true;
      } catch (error) {
        addIssue(issues, entity, "invalid-health-record", String(error));
        return false;
      }
    })
    .sort(compareEntities);
  const facts = valid.filter(
    (entity) =>
      entity.kind === "fact" && ["metric", "session"].includes(entity.type),
  );
  // Count all distinct targets before selecting available health plans. Otherwise
  // a hidden, missing or cross-domain target would silently lose its ambiguity.
  const actualTargets = new Map(
    facts.map((entity) => [
      entity.id,
      [
        ...new Set(
          entity.relations
            .filter((relation) => relation.type === "actual-of")
            .map((relation) => relation.target),
        ),
      ],
    ]),
  );
  const trends: HealthReport["trends"] = [];
  for (const entity of facts) {
    for (const observation of values.get(entity.id) ?? []) {
      let trend = trends.find(
        (trend) =>
          trend.measurement === observation.measurement &&
          trend.metric === observation.metric &&
          trend.unit === observation.unit,
      );
      if (!trend) {
        trend = {
          measurement: observation.measurement,
          metric: observation.metric,
          unit: observation.unit,
          points: [],
          change: null,
        };
        trends.push(trend);
      }
      trend.points.push({ ...observation, evidence: evidence(entity) });
    }
  }
  for (const trend of trends)
    if (trend.points.length >= 2)
      trend.change = trend.points.at(-1)!.value - trend.points[0].value;
  const plans = valid
    .filter((entity) => entity.kind === "plan")
    .map((plan) => {
      const actuals = facts.filter((entity) => {
        const targets = actualTargets.get(entity.id)!;
        return targets.length === 1 && targets[0] === plan.id;
      });
      const comparisons: HealthReport["plans"][number]["comparisons"] = [];
      const group = (observation: Observation) => {
        let comparison = comparisons.find(
          (comparison) =>
            comparison.metric === observation.metric &&
            comparison.unit === observation.unit,
        );
        if (!comparison) {
          comparison = {
            metric: observation.metric,
            unit: observation.unit,
            plannedTotal: null,
            recordedTotal: 0,
            completedTotal: 0,
            completedDifference: null,
            actualEntityIds: [],
            measurements: [],
          };
          comparisons.push(comparison);
        }
        return comparison;
      };
      for (const observation of values.get(plan.id) ?? []) {
        const comparison = group(observation);
        comparison.plannedTotal =
          (comparison.plannedTotal ?? 0) + observation.value;
      }
      for (const actual of actuals) {
        for (const observation of values.get(actual.id) ?? []) {
          const comparison = group(observation);
          comparison.recordedTotal += observation.value;
          if (actual.status === "done")
            comparison.completedTotal += observation.value;
          if (!comparison.actualEntityIds.includes(actual.id))
            comparison.actualEntityIds.push(actual.id);
          let mode = comparison.measurements.find(
            (mode) => mode.measurement === observation.measurement,
          );
          if (!mode) {
            mode = {
              measurement: observation.measurement,
              recordedTotal: 0,
              completedTotal: 0,
              entityIds: [],
            };
            comparison.measurements.push(mode);
          }
          mode.recordedTotal += observation.value;
          if (actual.status === "done")
            mode.completedTotal += observation.value;
          if (!mode.entityIds.includes(actual.id))
            mode.entityIds.push(actual.id);
        }
      }
      for (const comparison of comparisons)
        if (comparison.plannedTotal !== null)
          comparison.completedDifference =
            comparison.completedTotal - comparison.plannedTotal;
      return {
        plan: evidence(plan),
        title: plan.title,
        actuals: actuals.map(evidence),
        recordedCount: actuals.length,
        completedCount: actuals.filter((entity) => entity.status === "done")
          .length,
        comparisons,
      };
    });
  const planIds = new Set(plans.map((plan) => plan.plan.entityId));
  for (const fact of facts) {
    const targets = actualTargets.get(fact.id)!;
    if (targets.length > 1)
      addIssue(
        issues,
        fact,
        "ambiguous-health-plan",
        "Fact has multiple actual-of targets and is excluded from plan totals: " +
          targets.join(", "),
      );
    for (const target of targets)
      if (!planIds.has(target))
        addIssue(
          issues,
          fact,
          "missing-health-plan",
          "actual-of does not target an available health plan: " + target,
        );
  }
  return {
    trends: trends.sort(
      (a, b) =>
        a.measurement.localeCompare(b.measurement) ||
        a.metric.localeCompare(b.metric) ||
        a.unit.localeCompare(b.unit),
    ),
    plans,
    unlinkedActualEntityIds: facts
      .filter(
        (entity) =>
          !entity.relations.some(
            (relation) =>
              relation.type === "actual-of" && planIds.has(relation.target),
          ),
      )
      .map((entity) => entity.id),
    issues,
  };
}
