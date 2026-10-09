import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import {
  allocatePeriod,
  acceptPeriodPlan,
  periodReview,
} from "../src/period-planner.js";
import type { EntityInput } from "../src/types.js";
import type { PeriodPlanInput, PeriodDay } from "../src/period-planner.js";

const day = (date: string, overrides: Partial<PeriodDay> = {}): PeriodDay => ({
  date,
  scenario: "normal",
  startMinute: 480,
  endMinute: 500,
  protected: [],
  buffers: { meals: 0, commute: 0, preparation: 0, recovery: 0, sleep: 0 },
  ...overrides,
});
const input = (overrides: Partial<PeriodPlanInput> = {}): PeriodPlanInput => ({
  timeZone: "Asia/Tokyo",
  days: [day("2030-04-07")],
  goals: [{ id: "fictional-a", title: "虚构阅读", minutes: 60 }],
  ...overrides,
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "life-period-fictional-"));
  const store = new Store(root);
  return {
    store,
    close: () => {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("period rotation persists across week boundaries and serves short daily windows fairly", () => {
  const draft = allocatePeriod(
    input({
      days: Array.from({ length: 9 }, (_, i) =>
        day(`2030-04-${String(7 + i).padStart(2, "0")}`),
      ),
      goals: ["a", "b", "c"].map((id) => ({
        id,
        title: `虚构目标${id}`,
        minutes: 60,
      })),
    }),
  );
  assert.deepEqual(
    draft.slots.map((s) => s.goalId),
    ["a", "b", "c", "a", "b", "c", "a", "b", "c"],
  );
  assert.equal(draft.unscheduled.length, 0);
  assert.ok(draft.slots.every((s) => s.end - s.start === 20));
  assert.equal(draft.slots[1].date, "2030-04-08");
  assert.equal(draft.slots[0].startAt, "2030-04-07T08:00:00+09:00");
  assert.equal(draft.source.mode, "rule");
  assert.equal(draft.accepted, false);
});

test("a complete 366-day period serves 30 goals with bounded daily sessions", () => {
  const days = Array.from({ length: 366 }, (_, index) =>
    day(
      new Date(Date.UTC(2030, 0, 1) + index * 86400000)
        .toISOString()
        .slice(0, 10),
      { endMinute: 600 },
    ),
  );
  const goals = Array.from({ length: 30 }, (_, index) => ({
    id: `fictional-${index}`,
    title: `虚构年度目标 ${index}`,
    minutes: 1440,
    sessionMinutes: 5,
    minSessionMinutes: 5,
  }));
  const draft = allocatePeriod(input({ timeZone: "UTC", days, goals }));
  assert.equal(draft.days.length, 366);
  assert.equal(draft.slots.length, 8640);
  assert.equal(draft.unscheduled.length, 0);
  for (const goal of goals)
    assert.equal(
      draft.slots
        .filter((s) => s.goalId === goal.id)
        .reduce((n, s) => n + s.end - s.start, 0),
      1440,
    );
  assert.ok(draft.days.every((d) => d.scheduledMinutes <= 120));
  assert.ok(draft.slots.every((s) => s.start >= 480 && s.end <= 600));
});

test("scenario budgets and explicit capacity factors preserve zero and override defaults", () => {
  const minutes = (
    scenario: PeriodDay["scenario"],
    capacityFactor?: number,
  ) => {
    const draft = allocatePeriod(
      input({
        days: [day("2030-04-07", { endMinute: 580, scenario, capacityFactor })],
        goals: [
          {
            id: "a",
            title: "虚构目标",
            minutes: 100,
            sessionMinutes: 10,
            minSessionMinutes: 1,
          },
        ],
      }),
    );
    return draft.slots.reduce((n, s) => n + s.end - s.start, 0);
  };
  assert.equal(minutes("normal"), 100);
  assert.equal(minutes("overtime"), 60);
  assert.equal(minutes("fatigue"), 30);
  assert.equal(minutes("normal", 0), 0);
  assert.equal(minutes("fatigue", 0.8), 80);
  for (const factor of [-0.1, 1.1, NaN, Infinity])
    assert.throws(() => minutes("normal", factor), /capacityFactor/);
});

test("multiple windows reserve meals, traffic, preparation, recovery and sleep before goals", () => {
  const draft = allocatePeriod(
    input({
      days: [
        day("2030-04-07", {
          startMinute: 0,
          endMinute: 1440,
          windows: [
            { start: 480, end: 720 },
            { start: 1080, end: 1440 },
          ],
          protected: [
            { label: "虚构固定会议", start: 600, end: 660 },
            { label: "明确睡眠", start: 1320, end: 1440, kind: "sleep" },
          ],
          buffers: {
            meals: 30,
            commute: 20,
            preparation: 10,
            recovery: 20,
            sleep: 60,
          },
        }),
      ],
      goals: [{ id: "a", title: "虚构目标", minutes: 1440 }],
    }),
  );
  const reserved = draft.reservations;
  assert.equal(
    reserved
      .filter((r) => r.kind === "sleep")
      .reduce((n, r) => n + r.end - r.start, 0),
    180,
  );
  for (const slot of draft.slots) {
    assert.ok(
      reserved.every((r) => slot.end <= r.start || slot.start >= r.end),
    );
    assert.ok(
      (slot.start >= 480 && slot.end <= 720) ||
        (slot.start >= 1080 && slot.end <= 1440),
    );
  }
  assert.equal(draft.days[0].budgetMinutes, 280);
  assert.equal(
    draft.slots.reduce((n, s) => n + s.end - s.start, 0),
    280,
  );
  assert.ok(draft.unscheduled[0].reason.includes("容量"));
  const impossible = allocatePeriod(
    input({
      days: [
        day("2030-04-07", {
          buffers: {
            meals: 0,
            commute: 0,
            preparation: 0,
            recovery: 0,
            sleep: 21,
          },
        }),
      ],
    }),
  );
  assert.equal(impossible.slots.length, 0);
  assert.match(impossible.issues[0], /睡眠预留不足/);
});

test("travel to goals and onward fixed locations uses only user supplied directed durations", () => {
  const p = input({
    days: [
      day("2030-04-07", {
        startMinute: 480,
        endMinute: 550,
        startLocation: "虚构住处",
        protected: [
          { label: "虚构办公", start: 550, end: 600, location: "虚构办公室" },
        ],
        travel: [
          { from: "虚构住处", to: "虚构公园", minutes: 15 },
          { from: "虚构公园", to: "虚构办公室", minutes: 25 },
        ],
      }),
    ],
    goals: [
      {
        id: "a",
        title: "虚构散步",
        minutes: 30,
        location: "虚构公园",
        sessionMinutes: 30,
      },
    ],
  });
  const draft = allocatePeriod(p);
  assert.deepEqual(
    draft.slots.map((s) => [s.start, s.end]),
    [[495, 525]],
  );
  assert.deepEqual(
    draft.reservations
      .filter((r) => r.kind === "travel")
      .map((r) => [r.start, r.end]),
    [
      [480, 495],
      [525, 550],
    ],
  );
  const missing = structuredClone(p);
  missing.days[0].travel!.pop();
  const blocked = allocatePeriod(missing);
  assert.equal(blocked.slots.length, 0);
  assert.match(blocked.unscheduled[0].reason, /缺少用户填写的地点转移时长/);
  const noSpace = structuredClone(p);
  noSpace.days[0].travel![1].minutes = 60;
  assert.equal(allocatePeriod(noSpace).slots.length, 0);
});

test("location rotation also accounts for travel between successive goal sessions", () => {
  const draft = allocatePeriod(
    input({
      days: [
        day("2030-04-07", {
          endMinute: 580,
          startLocation: "虚构住处",
          travel: [
            { from: "虚构住处", to: "虚构公园", minutes: 10 },
            { from: "虚构公园", to: "虚构住处", minutes: 15 },
          ],
        }),
      ],
      goals: [
        { id: "a", title: "虚构散步", minutes: 20, location: "虚构公园" },
        { id: "b", title: "虚构阅读", minutes: 20, location: "虚构住处" },
      ],
    }),
  );
  assert.deepEqual(
    draft.slots.map((s) => [s.goalId, s.start, s.end]),
    [
      ["a", 490, 510],
      ["b", 525, 545],
    ],
  );
});

test("fixed location transfers remain protected even when there are no goal sessions", () => {
  const p = input({
    days: [
      day("2030-04-07", {
        endMinute: 660,
        protected: [
          { label: "虚构办公", start: 480, end: 540, location: "虚构办公室" },
          { label: "虚构固定活动", start: 600, end: 660, location: "虚构公园" },
        ],
        travel: [{ from: "虚构办公室", to: "虚构公园", minutes: 30 }],
      }),
    ],
    goals: [],
  });
  const draft = allocatePeriod(p);
  assert.deepEqual(
    draft.reservations
      .filter((r) => r.kind === "travel")
      .map((r) => [r.start, r.end]),
    [[570, 600]],
  );
  p.days[0].travel = [];
  const unresolved = allocatePeriod(p);
  assert.match(unresolved.issues[0], /固定地点.*缺少用户填写/);
  assert.equal(unresolved.days[0].budgetMinutes, 0);
  p.days[0].travel = [{ from: "虚构办公室", to: "虚构公园", minutes: 70 }];
  assert.match(allocatePeriod(p).issues[0], /没有足够连续交通时间/);
});

test("DST nonexistent, repeated and crossing clock times never silently choose an instant", () => {
  const spring = input({
    timeZone: "America/New_York",
    days: [day("2030-03-10", { startMinute: 150, endMinute: 170 })],
  });
  assert.throws(() => allocatePeriod(spring), /DST nonexistent/);
  assert.throws(
    () =>
      allocatePeriod({
        ...spring,
        days: [day("2030-03-10", { startMinute: 60, endMinute: 240 })],
      }),
    /DST clock transition/,
  );
  const autumn = input({
    timeZone: "America/New_York",
    days: [day("2030-11-03", { startMinute: 70, endMinute: 90 })],
    goals: [{ id: "a", title: "虚构目标", minutes: 20 }],
  });
  assert.throws(() => allocatePeriod(autumn), /DST ambiguous/);
  const earlier = allocatePeriod({
    ...autumn,
    days: [
      { ...autumn.days[0], offsets: { "01:10": "-04:00", "01:30": "-04:00" } },
    ],
  });
  const later = allocatePeriod({
    ...autumn,
    days: [
      { ...autumn.days[0], offsets: { "01:10": "-05:00", "01:30": "-05:00" } },
    ],
  });
  assert.equal(
    Date.parse(later.slots[0].startAt) - Date.parse(earlier.slots[0].startAt),
    3600000,
  );
  assert.throws(
    () =>
      allocatePeriod({
        ...autumn,
        days: [
          {
            ...autumn.days[0],
            offsets: { "01:10": "+09:00", "01:30": "+09:00" },
          },
        ],
      }),
    /offset does not match/,
  );
  // Split windows avoid the missing clock interval without rejecting the entire civil date.
  const split = allocatePeriod({
    ...spring,
    days: [
      day("2030-03-10", {
        startMinute: 60,
        endMinute: 240,
        windows: [
          { start: 60, end: 110 },
          { start: 180, end: 240 },
        ],
      }),
    ],
  });
  assert.ok(split.slots.length);
  assert.ok(
    split.slots.every(
      (s) =>
        Date.parse(s.endAt) - Date.parse(s.startAt) ===
        (s.end - s.start) * 60000,
    ),
  );
});

test("complete period validates date continuity, protected blocks and bounded inputs", () => {
  assert.throws(
    () =>
      allocatePeriod(input({ days: [day("2030-04-07"), day("2030-04-09")] })),
    /continuous/,
  );
  assert.throws(
    () => allocatePeriod(input({ days: [day("2030-02-30")] })),
    /continuous/,
  );
  assert.throws(
    () =>
      allocatePeriod(
        input({ days: Array.from({ length: 367 }, () => day("2030-04-07")) }),
      ),
    /366/,
  );
  assert.throws(
    () =>
      allocatePeriod(
        input({
          days: [
            day("2030-04-07", {
              protected: [
                { label: "虚构一", start: 480, end: 490 },
                { label: "虚构二", start: 485, end: 500 },
              ],
            }),
          ],
        }),
      ),
    /overlapping/,
  );
});

test("period suggestions do not write; confirmed acceptance links existing goals and retries after restart", () => {
  const f = fixture();
  try {
    const goal = f.store.save({
      expectedVersion: 0,
      entity: {
        module: "learning",
        type: "goal",
        title: "虚构阅读方向",
        kind: "plan",
        status: "active",
        occurredAt: "2030-04-07",
        timeZone: "Asia/Tokyo",
        fields: {},
        relations: [],
        body: "虚构测试数据。\n",
      },
    });
    const draft = allocatePeriod(
      input({ goals: [{ id: goal.id, title: "虚构阅读", minutes: 20 }] }),
    );
    assert.equal(f.store.list().length, 1);
    const accepted = acceptPeriodPlan(f.store, draft);
    assert.equal(accepted.length, 1);
    assert.deepEqual(accepted[0].relations, [
      { type: "supports", target: goal.id },
    ]);
    assert.equal(accepted[0].occurredAt, draft.slots[0].startAt);
    assert.equal(accepted[0].fields.scenario, "普通");
    assert.equal(accepted[0].kind, "plan");
    const audit = f.store.audit().length;
    assert.equal(acceptPeriodPlan(f.store, draft)[0].id, accepted[0].id);
    assert.equal(f.store.audit().length, audit);
    const restarted = new Store(f.store.root);
    try {
      assert.equal(acceptPeriodPlan(restarted, draft)[0].id, accepted[0].id);
    } finally {
      restarted.close();
    }
    const modified = structuredClone(draft);
    modified.slots[0].end++;
    assert.throws(() => acceptPeriodPlan(f.store, modified), /altered/);
    assert.equal(f.store.list().length, 2);
  } finally {
    f.close();
  }
});

test("failed batch acceptance rolls back every action and remains retryable", () => {
  const f = fixture();
  try {
    const draft = allocatePeriod(
      input({
        days: [day("2030-04-07", { endMinute: 520 })],
        goals: ["a", "b"].map((id) => ({
          id,
          title: `虚构${id}`,
          minutes: 20,
        })),
      }),
    );
    const original = f.store.saveInTransaction.bind(f.store);
    let call = 0;
    f.store.saveInTransaction = (...args) => {
      if (++call === 2) throw Error("Injected fictional batch interruption");
      return original(...args);
    };
    assert.throws(() => acceptPeriodPlan(f.store, draft), /interruption/);
    assert.equal(f.store.list().length, 0);
    assert.equal(f.store.audit().length, 0);
    f.store.saveInTransaction = original;
    assert.equal(acceptPeriodPlan(f.store, draft).length, 2);
    assert.equal(acceptPeriodPlan(f.store, draft).length, 2);
    assert.equal(f.store.list().length, 2);
  } finally {
    f.close();
  }
});

test("acceptance supports real cross-domain goals, language goals and planning directions", () => {
  const f = fixture();
  try {
    const targets = [
      { module: "planning", type: "direction", fields: { why: "虚构方向" } },
      {
        module: "languages",
        type: "language-goal",
        fields: { language: "日语" },
      },
      ...[
        "planning",
        "health",
        "learning",
        "projects",
        "languages",
        "quant",
        "finance",
        "family",
      ].map((module) => ({ module, type: "goal", fields: {} })),
    ].map(({ module, type, fields }) =>
      f.store.save({
        expectedVersion: 0,
        entity: {
          module,
          type,
          fields: fields as EntityInput["fields"],
          title: `虚构活动 ${module}/${type}`,
          kind: "plan",
          status: "active",
          occurredAt: "2030-04-07",
          timeZone: "Asia/Tokyo",
          relations: [],
          body: "虚构已保存目标。\n",
        },
      }),
    );
    const draft = allocatePeriod(
      input({
        days: [day("2030-04-07", { endMinute: 700 })],
        goals: targets.map((target) => ({
          id: target.id,
          title: target.title,
          minutes: 20,
        })),
      }),
    );
    assert.equal(f.store.list().length, targets.length);
    const actions = acceptPeriodPlan(f.store, draft);
    assert.equal(actions.length, targets.length);
    for (const target of targets) {
      const action = actions.find((e) =>
        e.relations.some(
          (r) => r.type === "supports" && r.target === target.id,
        ),
      );
      assert.ok(action, `Missing supports for ${target.module}/${target.type}`);
      assert.match(action.body, new RegExp(`${target.module}/${target.type}`));
      assert.equal(f.store.get(target.id)!.version, 1);
    }
    assert.deepEqual(
      acceptPeriodPlan(f.store, draft).map((e) => e.id),
      actions.map((e) => e.id),
    );
  } finally {
    f.close();
  }
});

test("period acceptance rejects reviews, factual and inactive goals; temporary text stays unlinked", () => {
  const f = fixture();
  try {
    const candidates: Partial<EntityInput>[] = [
      { type: "review" },
      { kind: "fact" },
      { status: "done" },
      { status: "draft" },
      { deleted: true },
    ];
    for (const candidate of candidates) {
      const target = f.store.save({
        expectedVersion: 0,
        entity: {
          module: "planning",
          type: "goal",
          title: "虚构不可选目标",
          kind: "plan",
          status: "active",
          occurredAt: "2030-04-07",
          timeZone: "Asia/Tokyo",
          fields: {},
          relations: [],
          body: "虚构测试。\n",
          ...candidate,
        },
      });
      const before = f.store.audit().length;
      const draft = allocatePeriod(
        input({ goals: [{ id: target.id, title: target.title, minutes: 20 }] }),
      );
      assert.throws(
        () => acceptPeriodPlan(f.store, draft),
        /active domain goal/,
      );
      assert.equal(f.store.audit().length, before);
    }
    const temporary = acceptPeriodPlan(f.store, allocatePeriod(input()))[0];
    assert.deepEqual(temporary.relations, []);
    assert.match(temporary.body, /临时文本目标，未关联已有目标实体/);
  } finally {
    f.close();
  }
});

test("review uses corresponding local facts and produces read-only evidence-backed suggestions", () => {
  const f = fixture();
  try {
    const draft = allocatePeriod(input());
    const plan = acceptPeriodPlan(f.store, draft)[0];
    const actual = f.store.save({
      expectedVersion: 0,
      entity: {
        module: "learning",
        type: "session",
        title: "虚构实际阅读",
        kind: "fact",
        status: "done",
        occurredAt: plan.occurredAt,
        timeZone: "Asia/Tokyo",
        fields: { minutes: 5 },
        relations: [{ type: "actual-of", target: plan.id }],
        body: "虚构事实。\n",
      },
    });
    const before = JSON.stringify(f.store.list());
    const audit = f.store.audit().length;
    const review = periodReview(f.store.list());
    assert.equal(review.rows[0].actualMinutes, 5);
    assert.deepEqual(review.suggestions[0].evidenceIds, [actual.id]);
    assert.match(review.suggestions[0].message, /实际 5 \/ 计划 20/);
    assert.equal(review.kind, "inference");
    assert.equal(review.accepted, false);
    assert.equal(f.store.audit().length, audit);
    assert.equal(JSON.stringify(f.store.list()), before);
    const noFacts = periodReview([plan]);
    assert.match(noFacts.suggestions[0].message, /尚无对应实际记录/);
    assert.match(noFacts.issues[0], /不等于未完成/);
    const otherPlan = { ...plan, id: "fictional-second-plan" };
    const ambiguousFact = {
      ...actual,
      relations: [
        ...actual.relations,
        { type: "actual-of", target: otherPlan.id },
      ],
    };
    const ambiguous = periodReview([plan, otherPlan, ambiguousFact]);
    assert.equal(ambiguous.ambiguousActualCount, 1);
    assert.ok(ambiguous.rows.every((r) => r.actualMinutes === 0));
    for (const otherTarget of [
      "fictional-health-plan",
      "fictional-missing-plan",
    ]) {
      const crossDomainFact = {
        ...actual,
        relations: [
          ...actual.relations,
          { type: "actual-of", target: otherTarget },
        ],
      };
      const crossDomainReview = periodReview([
        plan,
        crossDomainFact,
        ...(otherTarget === "fictional-health-plan"
          ? [{ ...plan, id: otherTarget, module: "health", type: "session" }]
          : []),
      ]);
      assert.equal(crossDomainReview.ambiguousActualCount, 1);
      assert.equal(crossDomainReview.rows[0].actualMinutes, 0);
      assert.deepEqual(crossDomainReview.rows[0].evidenceIds, []);
    }
  } finally {
    f.close();
  }
});
