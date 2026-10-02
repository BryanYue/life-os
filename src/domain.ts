import type { Entity, EntityInput, PlanDraft } from "./types.js";
import { Store } from "./store.js";
import { hash } from "./vault.js";
import { allocate } from "./planner.js";
export function addDecimal(a: string, b: string) {
  const scale = 8n,
    unit = 10n ** scale;
  const to = (s: string) => {
    if (!/^-?\d+(\.\d{1,8})?$/.test(s)) throw Error("Invalid exact amount");
    const neg = s.startsWith("-"),
      [whole, frac = ""] = s.replace("-", "").split(".");
    const n = BigInt(whole) * unit + BigInt(frac.padEnd(8, "0"));
    return neg ? -n : n;
  };
  const sum = to(a) + to(b),
    abs = sum < 0n ? -sum : sum;
  const fraction = (abs % unit).toString().padStart(8, "0").replace(/0+$/, "");
  return (
    (sum < 0n ? "-" : "") +
    (abs / unit).toString() +
    (fraction ? "." + fraction : "")
  );
}
export function summary(entities: Entity[]) {
  const counts = { plan: 0, fact: 0, inference: 0 };
  const byType: Record<string, number> = {};
  const groups = new Map<string, string>();
  const minutesByLanguage: Record<string, number> = {};
  for (const e of entities) {
    counts[e.kind]++;
    byType[e.type] = (byType[e.type] ?? 0) + 1;
    if (e.module === "finance" && e.type === "entry" && e.kind === "fact") {
      const key = String(e.fields.currency) + "|" + String(e.fields.category);
      groups.set(
        key,
        addDecimal(groups.get(key) ?? "0", String(e.fields.amount)),
      );
    }
    if (
      e.module === "languages" &&
      e.type === "practice" &&
      e.kind === "fact"
    ) {
      const l = String(e.fields.language);
      minutesByLanguage[l] =
        (minutesByLanguage[l] ?? 0) + Number(e.fields.minutes ?? 0);
    }
  }
  return {
    counts,
    byType,
    finance: [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, total]) => {
        const [currency, category] = key.split("|");
        return { currency, category, total };
      }),
    minutesByLanguage,
  };
}
export function acceptPlan(store: Store, draft: PlanDraft) {
  const calculated = allocate(draft.input);
  if (
    JSON.stringify(calculated) !== JSON.stringify(draft) ||
    !draft.slots.length
  )
    throw Error("Invalid or empty draft");
  return store.saveMany(
    draft.slots.map((slot, index) => {
      const goal = store.get(slot.goalId);
      return {
        expectedVersion: 0,
        operationId: hash(JSON.stringify(draft) + "|" + index),
        entity: {
          module: "planning",
          type: "action",
          title: slot.title,
          kind: "plan" as const,
          status: "active" as const,
          occurredAt: draft.input.date,
          timeZone: draft.input.timeZone,
          fields: {
            minutes: slot.end - slot.start,
            start: slot.start,
            end: slot.end,
            scenario: { normal: "普通", overtime: "加班", fatigue: "疲劳" }[
              draft.input.scenario
            ],
          },
          source: {
            namespace: "planning-rule",
            recordId: hash(JSON.stringify(draft) + "|" + index),
            revision: draft.ruleVersion,
            mode: "rule" as const,
          },
          relations: goal ? [{ type: "supports", target: goal.id }] : [],
          body:
            "人工采纳容量草案。规则 " +
            draft.ruleVersion +
            "。\n" +
            JSON.stringify(draft.input, null, 2) +
            "\n" +
            draft.issues.join("\n"),
        },
      };
    }),
  );
}
export function seedDemo(store: Store) {
  const added: Entity[] = [];
  for (const m of store.modules()) {
    if (store.list({ module: m.id }).length) continue;
    const goal = store.save({
      expectedVersion: 0,
      entity: {
        module: m.id,
        type: "goal",
        title: "虚构示例 · " + m.name + "方向",
        kind: "plan",
        status: "active",
        occurredAt: "2030-04-01",
        timeZone: "UTC",
        fields: { horizon: "示例阶段", measure: "完成一次记录并复盘" },
        relations: [],
        body: "这是可删除的虚构示例，不代表用户实际资料。",
      },
    });
    added.push(goal);
    const type = m.entityTypes.find((t) => !["goal", "review"].includes(t.id))!;
    const fields: EntityInput["fields"] = {};
    for (const f of type.fields)
      if (f.required)
        fields[f.key] =
          f.type === "number"
            ? 10
            : f.type === "decimal"
              ? "10.25"
              : f.type === "select"
                ? f.options![0]
                : f.type === "date"
                  ? "2030-04-01"
                  : f.key === "currency"
                    ? "USD"
                    : f.key === "parameters"
                      ? "{}"
                      : "虚构示例";
    added.push(
      store.save({
        expectedVersion: 0,
        entity: {
          module: m.id,
          type: type.id,
          title: "虚构示例 · " + type.name,
          kind: "fact",
          status: "done",
          occurredAt: "2030-04-02",
          timeZone: "UTC",
          fields,
          relations: [{ type: "supports", target: goal.id }],
          body: "示例记录，可编辑或移入回收站。",
        },
      }),
    );
  }
  return { added: added.length };
}
