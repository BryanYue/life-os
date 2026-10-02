import type { PlanInput, PlanDraft } from "./types.js";
export function allocate(input: PlanInput): PlanDraft {
  const nums = [
    input.startMinute,
    input.endMinute,
    ...Object.values(input.buffers ?? {}),
    ...(input.protected ?? []).flatMap((b) => [b.start, b.end]),
    ...(input.goals ?? []).map((g) => g.minutes),
  ];
  if (
    nums.some((n) => !Number.isSafeInteger(n) || n < 0) ||
    !["normal", "overtime", "fatigue"].includes(input.scenario) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
    !Number.isFinite(Date.parse(input.date)) ||
    new Date(input.date).toISOString().slice(0, 10) !== input.date ||
    input.endMinute > 1440 ||
    input.startMinute >= input.endMinute ||
    !Array.isArray(input.goals) ||
    input.goals.length > 30 ||
    new Set(input.goals.map((g) => g.id)).size !== input.goals.length ||
    ["meals", "commute", "preparation", "recovery", "sleep"].some(
      (k) => !(k in input.buffers),
    )
  )
    throw Error("Invalid planning input");
  new Intl.DateTimeFormat("en", { timeZone: input.timeZone });
  const blocks = [...input.protected].sort((a, b) => a.start - b.start);
  const issues: string[] = [];
  if (
    blocks.some(
      (b, i) =>
        b.start >= b.end ||
        b.start < input.startMinute ||
        b.end > input.endMinute ||
        (i > 0 && b.start < blocks[i - 1].end),
    )
  )
    issues.push("受保护时间块重叠或超出规划窗口，请先修正。");
  let cursor = input.startMinute;
  const free: { start: number; end: number }[] = [];
  for (const b of blocks) {
    if (cursor < b.start) free.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < input.endMinute)
    free.push({ start: cursor, end: input.endMinute });
  let reserve = Object.values(input.buffers).reduce((a, b) => a + b, 0);
  const freeMinutes = free.reduce((n, b) => n + b.end - b.start, 0);
  if (reserve > freeMinutes)
    issues.push("用餐、交通、准备、恢复与睡眠预留超过可用容量。");
  for (const b of free) {
    const take = Math.min(reserve, b.end - b.start);
    b.start += take;
    reserve -= take;
  }
  const available = Math.max(
    0,
    freeMinutes - Object.values(input.buffers).reduce((a, b) => a + b, 0),
  );
  const budget = Math.floor(
    available * { normal: 1, overtime: 0.6, fatigue: 0.3 }[input.scenario],
  );
  let remaining = budget;
  const slots: PlanDraft["slots"] = [],
    unscheduled: PlanDraft["unscheduled"] = [];
  const per = input.goals.length ? Math.floor(budget / input.goals.length) : 0;
  for (const g of input.goals) {
    let need = issues.length ? 0 : Math.min(g.minutes, per, remaining),
      assigned = 0;
    for (const b of free) {
      const take = Math.min(need, b.end - b.start);
      if (take > 0) {
        slots.push({
          goalId: g.id,
          title: g.title,
          start: b.start,
          end: b.start + take,
        });
        b.start += take;
        need -= take;
        assigned += take;
        remaining -= take;
      }
    }
    if (assigned < g.minutes)
      unscheduled.push({ id: g.id, minutes: g.minutes - assigned });
  }
  if (unscheduled.length)
    issues.push(
      "目标超出当前情境容量；保留受保护时间，可减少目标时长或轮换到其他日期。",
    );
  return {
    kind: "inference",
    ruleVersion: "capacity-v1",
    input,
    slots,
    unscheduled,
    issues,
    accepted: false,
  };
}
