import type { Entity, PlanInput, Source } from "./types.js";
import type { Store } from "./store.js";
import { hash } from "./vault.js";

export type PeriodDay = {
  date: string;
  scenario: PlanInput["scenario"];
  /** Explicit factors override the scenario default, including zero. */
  capacityFactor?: number;
  startMinute: number;
  endMinute: number;
  windows?: { start: number; end: number }[];
  protected: {
    label: string;
    start: number;
    end: number;
    location?: string;
    kind?: "fixed" | "sleep";
  }[];
  buffers: PlanInput["buffers"];
  startLocation?: string;
  travel?: { from: string; to: string; minutes: number }[];
  /** Repeated wall times require an explicit offset, e.g. {"01:30":"-04:00"}. */
  offsets?: Record<string, string>;
};
export type PeriodGoal = {
  id: string;
  title: string;
  /** Total demand over the complete period, not a daily quota. */
  minutes: number;
  sessionMinutes?: number;
  minSessionMinutes?: number;
  location?: string;
};
export type PeriodPlanInput = {
  timeZone: string;
  /** Continuous ascending dates; a maximum of 366 days and 30 goals. */
  days: PeriodDay[];
  goals: PeriodGoal[];
};
type Interval = { start: number; end: number };
type Anchor = Interval & { location: string; from?: string };
type Timed = Interval & { date: string; startAt: string; endAt: string };
export type PeriodPlanDraft = {
  kind: "inference";
  source: Source;
  ruleVersion: "period-capacity-v1";
  input: PeriodPlanInput;
  slots: (Timed & { goalId: string; title: string; location?: string })[];
  reservations: (Timed & {
    label: string;
    kind: "fixed" | "sleep" | keyof PlanInput["buffers"] | "travel";
    location?: string;
  })[];
  days: {
    date: string;
    capacityFactor: number;
    budgetMinutes: number;
    scheduledMinutes: number;
  }[];
  unscheduled: { id: string; minutes: number; reason: string }[];
  issues: string[];
  accepted: false;
};

const defaults = { normal: 1, overtime: 0.6, fatigue: 0.3 };
const bufferKeys = [
  "meals",
  "commute",
  "preparation",
  "recovery",
  "sleep",
] as const;
const labels = {
  meals: "餐食预留",
  commute: "交通预留",
  preparation: "准备预留",
  recovery: "恢复预留",
  sleep: "睡眠预留",
};
const validMinutes = (n: unknown, max = 1440): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= max;
const text = (s: unknown): s is string =>
  typeof s === "string" && s.trim().length > 0 && s.length <= 500;
const nextDate = (date: string) =>
  new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10);
const clock = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

function validate(input: PeriodPlanInput) {
  if (
    !input ||
    !text(input.timeZone) ||
    !Array.isArray(input.days) ||
    input.days.length < 1 ||
    input.days.length > 366 ||
    !Array.isArray(input.goals) ||
    input.goals.length > 30
  )
    throw Error("Invalid period planning input (1–366 days, at most 30 goals)");
  new Intl.DateTimeFormat("en", { timeZone: input.timeZone });
  if (new Set(input.goals.map((g) => g?.id)).size !== input.goals.length)
    throw Error("Duplicate period goal ID");
  for (const g of input.goals) {
    const session = g?.sessionMinutes ?? 20;
    const minimum =
      g?.minSessionMinutes ?? Math.min(10, session, g?.minutes || 10);
    if (
      !g ||
      !text(g.id) ||
      !text(g.title) ||
      !validMinutes(g.minutes, 527040) ||
      !validMinutes(session) ||
      session < 1 ||
      !validMinutes(minimum) ||
      minimum < 1 ||
      minimum > session ||
      (g.location !== undefined && !text(g.location))
    )
      throw Error("Invalid period goal/session duration");
  }
  input.days.forEach((d, index) => {
    if (
      !d ||
      !/^\d{4}-\d{2}-\d{2}$/.test(d.date) ||
      !Number.isFinite(Date.parse(d.date)) ||
      new Date(d.date).toISOString().slice(0, 10) !== d.date ||
      (index > 0 && d.date !== nextDate(input.days[index - 1].date)) ||
      !Object.hasOwn(defaults, d.scenario) ||
      !validMinutes(d.startMinute) ||
      !validMinutes(d.endMinute) ||
      d.startMinute >= d.endMinute ||
      (d.capacityFactor !== undefined &&
        (typeof d.capacityFactor !== "number" ||
          !Number.isFinite(d.capacityFactor) ||
          d.capacityFactor < 0 ||
          d.capacityFactor > 1)) ||
      !Array.isArray(d.protected) ||
      d.protected.length > 100 ||
      !d.buffers ||
      Object.keys(d.buffers).length !== bufferKeys.length ||
      bufferKeys.some((k) => !validMinutes(d.buffers[k])) ||
      (d.startLocation !== undefined && !text(d.startLocation))
    )
      throw Error(
        "Invalid period day: dates must be continuous; capacityFactor must be 0..1",
      );
    const checkIntervals = (blocks: Interval[]) =>
      blocks.some(
        (b, i) =>
          !b ||
          !validMinutes(b.start) ||
          !validMinutes(b.end) ||
          b.start >= b.end ||
          (i > 0 && b.start < blocks[i - 1].end),
      );
    const blocks = [...d.protected].sort((a, b) => a.start - b.start);
    if (
      checkIntervals(blocks) ||
      blocks.some(
        (b) =>
          !text(b.label) ||
          (b.location !== undefined && !text(b.location)) ||
          (b.kind !== undefined && !["fixed", "sleep"].includes(b.kind)),
      )
    )
      throw Error("Invalid or overlapping protected period blocks");
    if (
      d.windows !== undefined &&
      (!Array.isArray(d.windows) ||
        d.windows.length < 1 ||
        d.windows.length > 100)
    )
      throw Error("Invalid period windows");
    const windows = [
      ...(d.windows ?? [{ start: d.startMinute, end: d.endMinute }]),
    ].sort((a, b) => a.start - b.start);
    if (
      checkIntervals(windows) ||
      windows.some((w) => w.start < d.startMinute || w.end > d.endMinute)
    )
      throw Error("Invalid or overlapping period windows");
    if (
      d.travel !== undefined &&
      (!Array.isArray(d.travel) ||
        d.travel.length > 100 ||
        d.travel.some(
          (t) =>
            !t ||
            !text(t.from) ||
            !text(t.to) ||
            !validMinutes(t.minutes) ||
            t.from === t.to,
        ) ||
        new Set(d.travel.map((t) => JSON.stringify([t.from, t.to]))).size !==
          d.travel.length)
    )
      throw Error("Invalid or duplicate user travel durations");
    if (
      d.offsets !== undefined &&
      (!d.offsets ||
        typeof d.offsets !== "object" ||
        Array.isArray(d.offsets) ||
        Object.entries(d.offsets).some(
          ([k, v]) =>
            !/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(k) ||
            typeof v !== "string" ||
            !/^[+-](?:0\d|1\d|2[0-3]):[0-5]\d$/.test(v),
        ))
    )
      throw Error("Invalid explicit clock offsets");
  });
}

/** Resolve wall times from observed IANA offsets, never the machine timezone. */
function timeResolver(timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = (instant: number) => {
    const p = Object.fromEntries(
      formatter.formatToParts(instant).map((p) => [p.type, p.value]),
    );
    return Date.parse(
      `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`,
    );
  };
  const offsetsByDate = new Map<string, number[]>();
  const cache = new Map<string, { at: string; instant: number }>();
  return (day: PeriodDay, minute: number) => {
    const date = minute === 1440 ? nextDate(day.date) : day.date;
    const key = `${day.date}|${minute}|${day.offsets?.[clock(minute)] ?? ""}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const wall = Date.parse(
      `${date}T${clock(minute === 1440 ? 0 : minute)}:00Z`,
    );
    let offsets = offsetsByDate.get(date);
    if (!offsets) {
      // A bounded set of offset samples covers both sides of clock transitions.
      const midnight = Date.parse(date);
      offsets = [
        ...new Set(
          Array.from({ length: 13 }, (_, i) => {
            const instant = midnight + (i * 6 - 36) * 3600000;
            return parts(instant) - instant;
          }),
        ),
      ];
      offsetsByDate.set(date, offsets);
    }
    const candidates = offsets
      .map((offset) => ({ offset, instant: wall - offset }))
      .filter((c) => parts(c.instant) === wall);
    if (!candidates.length)
      throw Error(
        `DST nonexistent clock time: ${day.date} ${clock(minute)} in ${timeZone}; choose another window`,
      );
    const explicit = day.offsets?.[clock(minute)];
    const offsetString = (offset: number) => {
      const n = Math.abs(offset) / 60000;
      return `${offset < 0 ? "-" : "+"}${clock(n)}`;
    };
    if (candidates.length > 1 && !explicit)
      throw Error(
        `DST ambiguous clock time: ${day.date} ${clock(minute)}; provide offsets["${clock(minute)}"] (${candidates.map((c) => offsetString(c.offset)).join(" or ")})`,
      );
    const chosen = explicit
      ? candidates.find((c) => offsetString(c.offset) === explicit)
      : candidates[0];
    if (!chosen)
      throw Error(
        `Explicit offset does not match ${day.date} ${clock(minute)} in ${timeZone}`,
      );
    const result = {
      at: `${date}T${clock(minute === 1440 ? 0 : minute)}:00${offsetString(chosen.offset)}`,
      instant: chosen.instant,
    };
    cache.set(key, result);
    return result;
  };
}

function subtract(free: Interval[], block: Interval) {
  return free.flatMap((w) => {
    if (block.end <= w.start || block.start >= w.end) return [w];
    return [
      ...(block.start > w.start ? [{ start: w.start, end: block.start }] : []),
      ...(block.end < w.end ? [{ start: block.end, end: w.end }] : []),
    ];
  });
}

function firstIndex<T>(items: T[], predicate: (item: T) => boolean) {
  let low = 0,
    high = items.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (predicate(items[middle])) high = middle;
    else low = middle + 1;
  }
  return low;
}

export function allocatePeriod(raw: PeriodPlanInput): PeriodPlanDraft {
  validate(raw);
  const input = structuredClone(raw);
  const resolve = timeResolver(input.timeZone);
  const timed = (day: PeriodDay, start: number, end: number): Timed => {
    const a = resolve(day, start),
      b = resolve(day, end);
    if ((b.instant - a.instant) / 60000 !== end - start)
      throw Error(
        `DST clock transition in ${day.date} ${clock(start)}–${clock(end)}; split the window/block around the transition and explicitly select repeated offsets`,
      );
    return { date: day.date, start, end, startAt: a.at, endAt: b.at };
  };
  const fingerprint = hash(JSON.stringify(input));
  const draft: PeriodPlanDraft = {
    kind: "inference",
    ruleVersion: "period-capacity-v1",
    source: {
      namespace: "period-planning-rule",
      recordId: fingerprint,
      revision: "period-capacity-v1",
      mode: "rule",
    },
    input,
    slots: [],
    reservations: [],
    days: [],
    unscheduled: [],
    issues: [],
    accepted: false,
  };
  const remaining = input.goals.map((g) => g.minutes);
  const reasons = input.goals.map(() => new Set<string>());
  let rotation = 0;
  for (const day of input.days) {
    const initialRotation = rotation;
    const initialSlots = draft.slots.length;
    let free = [
      ...(day.windows ?? [{ start: day.startMinute, end: day.endMinute }]),
    ]
      .map((w) => ({ ...w }))
      .sort((a, b) => a.start - b.start);
    for (const w of free) timed(day, w.start, w.end);
    const anchors: Anchor[] = [];
    const addAnchor = (anchor: Anchor) =>
      anchors.splice(
        firstIndex(
          anchors,
          (a) =>
            a.start > anchor.start ||
            (a.start === anchor.start && a.end >= anchor.end),
        ),
        0,
        anchor,
      );
    for (const block of day.protected) {
      draft.reservations.push({
        ...timed(day, block.start, block.end),
        label: block.label,
        kind: block.kind ?? "fixed",
        ...(block.location ? { location: block.location } : {}),
      });
      free = subtract(free, block);
      if (block.location) addAnchor({ ...block, location: block.location });
    }
    if (
      day.startLocation &&
      !anchors.some(
        (a) => a.start <= day.startMinute && a.end > day.startMinute,
      )
    )
      addAnchor({
        start: day.startMinute,
        end: day.startMinute,
        location: day.startLocation,
      });
    let invalidDay = false;
    // Sleep and recovery occupy the end of free windows; other buffers occupy the beginning.
    for (const kind of [
      "sleep",
      "recovery",
      "meals",
      "commute",
      "preparation",
    ] as const) {
      let reserve = day.buffers[kind];
      const reverse = kind === "sleep" || kind === "recovery";
      for (const w of reverse ? [...free].reverse() : free) {
        const take = Math.min(reserve, w.end - w.start);
        if (!take) continue;
        const start = reverse ? w.end - take : w.start;
        draft.reservations.push({
          ...timed(day, start, start + take),
          kind,
          label: labels[kind],
        });
        if (reverse) w.end -= take;
        else w.start += take;
        reserve -= take;
      }
      if (reserve > 0) {
        invalidDay = true;
        draft.issues.push(
          `${day.date}：${labels[kind]}不足 ${reserve} 分钟；该日不安排目标。`,
        );
      }
    }
    const factor = day.capacityFactor ?? defaults[day.scenario];
    const baselineReservations = draft.reservations.length;
    let budget = invalidDay
      ? 0
      : Math.floor(free.reduce((n, w) => n + w.end - w.start, 0) * factor);
    const daySummary = {
      date: day.date,
      capacityFactor: factor,
      budgetMinutes: budget,
      scheduledMinutes: 0,
    };
    draft.days.push(daySummary);
    const route = (from: string | undefined, to: string | undefined) => {
      if (!from || !to || from === to) return 0;
      return day.travel?.find((t) => t.from === from && t.to === to)?.minutes;
    };
    while (budget > 0 && remaining.some((n) => n > 0)) {
      let success = false;
      for (let attempt = 0; attempt < input.goals.length; attempt++) {
        const index = (rotation + attempt) % input.goals.length;
        if (!remaining[index]) continue;
        const goal = input.goals[index],
          session = goal.sessionMinutes ?? 20;
        const minimum =
          goal.minSessionMinutes ?? Math.min(10, session, goal.minutes || 10);
        const wanted = Math.min(session, remaining[index], budget);
        if (wanted < minimum) {
          reasons[index].add("剩余容量或需求不足最短单次时长");
          continue;
        }
        for (const window of free) {
          if (window.end <= window.start) continue;
          const previous =
            anchors[firstIndex(anchors, (a) => a.end > window.start) - 1];
          const next =
            anchors[firstIndex(anchors, (a) => a.start >= window.end)];
          const from = previous?.location ?? day.startLocation;
          const location = goal.location ?? from ?? next?.location;
          const before = route(from, location),
            after = route(location, next?.location);
          if (before === undefined || after === undefined) {
            reasons[index].add("缺少用户填写的地点转移时长；不推测路线");
            continue;
          }
          const take = Math.min(
            wanted,
            window.end - window.start - before - after,
          );
          if (take < minimum) {
            reasons[index].add("固定块、预留或交通后缺少连续时间");
            continue;
          }
          const start = window.start + before,
            end = start + take;
          if (before) {
            draft.reservations.push({
              ...timed(day, window.start, start),
              kind: "travel",
              label: `${from} → ${location}（用户填写）`,
              location,
            });
            addAnchor({
              start: window.start,
              end: start,
              location: location!,
              from,
            });
          }
          draft.slots.push({
            ...timed(day, start, end),
            goalId: goal.id,
            title: goal.title,
            ...(location ? { location } : {}),
          });
          if (location) addAnchor({ start, end, location });
          if (after) {
            draft.reservations.push({
              ...timed(day, end, end + after),
              kind: "travel",
              label: `${location} → ${next.location}（用户填写）`,
              location: next.location,
            });
            addAnchor({
              start: end,
              end: end + after,
              location: next.location,
              from: location,
            });
          }
          window.start = end + after;
          remaining[index] -= take;
          budget -= take;
          daySummary.scheduledMinutes += take;
          rotation = (index + 1) % input.goals.length;
          success = true;
          break;
        }
        if (success) break;
      }
      if (!success) break;
    }
    // Fixed commitments still need transport when no goal session bridges them.
    const orderedAnchors = anchors.filter((a) => a.end >= day.startMinute);
    for (let i = 1; i < orderedAnchors.length; i++) {
      const previous = orderedAnchors[i - 1],
        next = orderedAnchors[i];
      if (
        previous.location === next.location ||
        next.from === previous.location
      )
        continue;
      const duration = route(previous.location, next.location);
      const candidates = free.filter(
        (w) =>
          Math.min(w.end, next.start) - Math.max(w.start, previous.end) >=
          (duration ?? Infinity),
      );
      const window = candidates.at(-1);
      if (duration === undefined || (!window && duration > 0)) {
        invalidDay = true;
        draft.issues.push(
          `${day.date}：固定地点 ${previous.location} → ${next.location} ${duration === undefined ? "缺少用户填写的交通时长" : "没有足够连续交通时间"}；该日不安排目标。`,
        );
        break;
      }
      if (duration && window) {
        const end = Math.min(window.end, next.start),
          start = end - duration;
        draft.reservations.push({
          ...timed(day, start, end),
          kind: "travel",
          label: `${previous.location} → ${next.location}（用户填写）`,
          location: next.location,
        });
        free = subtract(free, { start, end });
      }
    }
    if (invalidDay) {
      for (const slot of draft.slots.splice(initialSlots)) {
        const index = input.goals.findIndex((g) => g.id === slot.goalId);
        remaining[index] += slot.end - slot.start;
        reasons[index].add("该日固定约束或地点交通不可行");
      }
      draft.reservations.splice(baselineReservations);
      daySummary.budgetMinutes = 0;
      daySummary.scheduledMinutes = 0;
      rotation = initialRotation;
    }
  }
  input.goals.forEach((g, i) => {
    if (remaining[i])
      draft.unscheduled.push({
        id: g.id,
        minutes: remaining[i],
        reason: [
          ...reasons[i],
          "周期内情境容量、保护时间和轮换规则限制；可降低需求或扩展日期",
        ].join("；"),
      });
  });
  if (draft.unscheduled.length)
    draft.issues.push(
      "部分目标未排入；草案保留保护块和生活预留，可调整时长、地点或日期后重算。",
    );
  draft.slots.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  draft.reservations.sort(
    (a, b) => a.date.localeCompare(b.date) || a.start - b.start,
  );
  return draft;
}

export function acceptPeriodPlan(store: Store, draft: PeriodPlanDraft) {
  const calculated = allocatePeriod(draft?.input);
  if (
    JSON.stringify(calculated) !== JSON.stringify(draft) ||
    !draft.slots.length
  )
    throw Error("Invalid, altered or empty period draft");
  const goals = new Map(draft.input.goals.map((g) => [g.id, store.get(g.id)]));
  for (const entity of goals.values()) {
    if (
      entity &&
      (entity.kind !== "plan" ||
        entity.status !== "active" ||
        entity.deleted ||
        !(
          entity.type === "goal" ||
          (entity.module === "planning" && entity.type === "direction") ||
          (entity.module === "languages" && entity.type === "language-goal")
        ))
    )
      throw Error(
        "Period slot relation must target an active domain goal or planning direction",
      );
  }
  const draftIdentity = hash(JSON.stringify(draft));
  const dayMap = new Map(draft.input.days.map((d) => [d.date, d]));
  const context = new Map(
    draft.input.days.map((day) => [
      day.date,
      JSON.stringify(
        {
          periodId: draft.source.recordId,
          from: draft.input.days[0].date,
          to: draft.input.days.at(-1)!.date,
          day,
          reservations: draft.reservations.filter((r) => r.date === day.date),
        },
        null,
        2,
      ),
    ]),
  );
  return store.saveMany(
    draft.slots.map((slot, index) => {
      const day = dayMap.get(slot.date)!;
      const goal = goals.get(slot.goalId);
      const operationId = hash(draftIdentity + "|" + index);
      return {
        expectedVersion: 0,
        operationId,
        entity: {
          module: "planning",
          type: "action",
          title: slot.title,
          kind: "plan" as const,
          status: "active" as const,
          occurredAt: slot.startAt,
          timeZone: draft.input.timeZone,
          fields: {
            minutes: slot.end - slot.start,
            start: slot.start,
            end: slot.end,
            scenario: { normal: "普通", overtime: "加班", fatigue: "疲劳" }[
              day.scenario
            ],
          },
          source: {
            namespace: draft.source.namespace,
            recordId: operationId,
            revision: draft.ruleVersion,
            mode: "rule" as const,
          },
          relations: goal ? [{ type: "supports", target: goal.id }] : [],
          body: `人工采纳周期容量草案。规则 ${draft.ruleVersion}。\n目标关联：${goal ? `${goal.title}（${goal.module}/${goal.type}，${goal.id}）` : "临时文本目标，未关联已有目标实体"}。\n时间 ${slot.startAt} – ${slot.endAt}；地点 ${slot.location ?? "未指定"}；容量系数 ${day.capacityFactor ?? defaults[day.scenario]}。\n${context.get(slot.date)}\n${JSON.stringify(draft.input.goals.find((g) => g.id === slot.goalId))}\n${draft.issues.join("\n")}\n`,
        },
      };
    }),
  );
}

export function periodReview(entities: Entity[]) {
  const active = entities.filter((e) => !e.deleted);
  const plans = active.filter(
    (e) => e.module === "planning" && e.type === "action" && e.kind === "plan",
  );
  const planIds = new Set(plans.map((e) => e.id));
  const actuals = active.filter(
    (e) =>
      e.kind === "fact" &&
      typeof e.fields.minutes === "number" &&
      Number.isFinite(e.fields.minutes) &&
      e.fields.minutes >= 0,
  );
  const targets = (e: Entity) => [
    ...new Set(
      e.relations.filter((r) => r.type === "actual-of").map((r) => r.target),
    ),
  ];
  const ambiguousActualCount = actuals.filter(
    (e) => targets(e).length > 1 && targets(e).some((id) => planIds.has(id)),
  ).length;
  const rows = plans.map((plan) => {
    const facts = actuals.filter(
      (e) => targets(e).length === 1 && targets(e)[0] === plan.id,
    );
    return {
      planId: plan.id,
      title: plan.title,
      plannedMinutes: Number(plan.fields.minutes ?? 0),
      actualMinutes: facts.reduce((n, f) => n + Number(f.fields.minutes), 0),
      evidenceIds: facts.map((f) => f.id),
      goalIds: plan.relations
        .filter((r) => r.type === "supports")
        .map((r) => r.target),
    };
  });
  const unmatchedActualCount = actuals.filter(
    (e) =>
      !e.relations.some((r) => r.type === "actual-of" && planIds.has(r.target)),
  ).length;
  const suggestions = rows
    .filter((r) => !r.evidenceIds.length || r.actualMinutes < r.plannedMinutes)
    .map((r) => ({
      planId: r.planId,
      evidenceIds: r.evidenceIds,
      message: !r.evidenceIds.length
        ? `${r.title}：尚无对应实际记录；可补录事实后再判断。`
        : `${r.title}：对应实际 ${r.actualMinutes} / 计划 ${r.plannedMinutes} 分钟；可考虑缩短下一周期时长或轮换日期。`,
    }));
  return {
    kind: "inference" as const,
    accepted: false as const,
    ruleVersion: "period-review-v1",
    source: {
      namespace: "period-review-rule",
      recordId: hash(JSON.stringify(active)),
      revision: "period-review-v1",
      mode: "rule" as const,
    },
    rows,
    unmatchedActualCount,
    ambiguousActualCount,
    suggestions,
    issues: [
      "仅依据本地事实与 actual-of 关系生成建议；缺少记录不等于未完成。",
      ...(ambiguousActualCount
        ? [
            `${ambiguousActualCount} 条实际记录对应多个计划，未重复计入；请明确分钟归属。`,
          ]
        : []),
    ],
  };
}
