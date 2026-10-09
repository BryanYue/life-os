import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import {
  createLearningTask,
  checkInLearningTask,
  createLearningReminder,
  actOnLearningReminder,
  ackLearningReminder,
  snoozeLearningReminder,
  reportLearningTasks,
  validateLearningTimestamp,
} from "../src/learning-tasks.js";
import type { LearningTaskInput } from "../src/learning-tasks.js";
import type { EntityInput } from "../src/types.js";

const start = "2030-04-07T08:00:00+09:00";
const at = "2030-04-08T12:00:00+09:00";
const zone = "Asia/Tokyo";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "life-learning-fictional-"));
  const store = new Store(join(root, "data"));
  return {
    root,
    store,
    close: () => {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
function save(
  store: Store,
  module: string,
  type: string,
  fields: EntityInput["fields"] = {},
  partial: Partial<EntityInput> = {},
) {
  return store.save({
    expectedVersion: 0,
    entity: {
      module,
      type,
      title: `虚构 ${module}/${type}`,
      kind: "plan",
      status: "active",
      occurredAt: start,
      timeZone: zone,
      fields,
      relations: [],
      body: "虚构学习任务测试。\n",
      ...partial,
    },
  });
}
const taskInput = (
  overrides: Partial<LearningTaskInput> = {},
): LearningTaskInput => ({
  title: "虚构阅读清单",
  timeZone: zone,
  occurredAt: start,
  due: at,
  focus: "虚构重点",
  body: "用户自己的任务正文。\n",
  operationId: "fictional-create-task",
  ...overrides,
});

test("learning checklist associates multiple real goals and material without double counting unique tasks", () => {
  const f = fixture();
  try {
    assert.equal(f.store.module("learning").schemaVersion, 2);
    const goals = [
      save(f.store, "learning", "goal"),
      save(f.store, "planning", "direction"),
      save(f.store, "languages", "language-goal", { language: "英语" }),
    ];
    const material = save(f.store, "learning", "material");
    const sourceFact = save(
      f.store,
      "learning",
      "note",
      {},
      { kind: "fact", status: "done" },
    );
    const input = taskInput({
      goalIds: goals.map((g) => g.id),
      materialId: material.id,
      evidenceIds: [sourceFact.id, material.id],
    });
    const item = createLearningTask(f.store, input);
    const audit = f.store.audit().length;
    assert.equal(createLearningTask(f.store, input).id, item.id);
    assert.equal(f.store.audit().length, audit);
    assert.equal(item.kind, "plan");
    assert.equal(item.status, "active");
    assert.equal(item.body, input.body);
    assert.equal(item.fields.focus, input.focus);
    assert.equal(item.relations.filter((r) => r.type === "supports").length, 3);
    assert.equal(item.relations.filter((r) => r.type === "evidence").length, 2);
    const independent = createLearningTask(
      f.store,
      taskInput({
        operationId: "fictional-independent",
        title: "虚构独立任务",
      }),
    );
    assert.deepEqual(independent.relations, []);
    const report = reportLearningTasks(
      [...f.store.list(), item, independent],
      at,
    );
    assert.deepEqual(report.counts, {
      total: 2,
      completed: 0,
      pending: 2,
      checkIns: 0,
    });
    assert.equal(report.goalViews.length, 3);
    assert.ok(
      report.goalViews.every(
        (view) => view.pending === 1 && view.taskIds[0] === item.id,
      ),
    );
    assert.equal(
      report.tasks.find((row) => row.id === item.id)!.materialIds[0],
      material.id,
    );
  } finally {
    f.close();
  }
});

test("completion, idempotent retry, undo and re-completion preserve factual history and one reading duration", () => {
  const f = fixture();
  try {
    const item = createLearningTask(f.store, taskInput());
    const completion = {
      taskId: item.id,
      expectedVersion: item.version,
      operationId: "fictional-complete",
      outcome: "完成" as const,
      note: "虚构已完成",
      occurredAt: at,
    };
    const first = checkInLearningTask(f.store, completion);
    assert.equal(first.task.status, "done");
    assert.equal(first.task.version, 2);
    assert.equal(first.task.occurredAt, item.occurredAt);
    assert.deepEqual(first.task.source, item.source);
    assert.equal(first.checkIn.kind, "fact");
    assert.equal(first.checkIn.fields.outcome, "完成");
    assert.equal(first.checkIn.occurredAt, at);
    assert.deepEqual(first.checkIn.relations, [
      { type: "actual-of", target: item.id },
    ]);
    const after = f.store.audit().length;
    assert.equal(
      checkInLearningTask(f.store, completion).checkIn.id,
      first.checkIn.id,
    );
    assert.equal(f.store.audit().length, after);
    assert.throws(
      () =>
        checkInLearningTask(f.store, { ...completion, note: "重复ID改内容" }),
      /reused/,
    );
    assert.throws(
      () =>
        checkInLearningTask(f.store, {
          ...completion,
          operationId: "fictional-stale",
          outcome: "撤销",
        }),
      /Version conflict/,
    );
    const undone = checkInLearningTask(f.store, {
      ...completion,
      expectedVersion: first.task.version,
      operationId: "fictional-undo",
      outcome: "撤销",
      occurredAt: "2030-04-08T12:05:00+09:00",
    });
    assert.equal(undone.task.status, "active");
    assert.equal(undone.checkIn.fields.outcome, "撤销");
    assert.notEqual(undone.checkIn.id, first.checkIn.id);
    const oldRetry = checkInLearningTask(f.store, completion);
    assert.equal(oldRetry.task.status, "active");
    assert.equal(oldRetry.checkIn.id, first.checkIn.id);
    const final = checkInLearningTask(f.store, {
      ...completion,
      expectedVersion: undone.task.version,
      operationId: "fictional-recomplete",
      occurredAt: "2030-04-08T12:10:00+09:00",
    });
    assert.equal(final.task.status, "done");
    const session = save(
      f.store,
      "learning",
      "session",
      { minutes: 25 },
      {
        kind: "fact",
        status: "done",
        relations: [{ type: "actual-of", target: item.id }],
      },
    );
    const report = reportLearningTasks(f.store.list(), at);
    assert.deepEqual(report.counts, {
      total: 1,
      completed: 1,
      pending: 0,
      checkIns: 3,
    });
    assert.deepEqual(
      report.checkIns.map((e) => e.fields.outcome),
      ["完成", "撤销", "完成"],
    );
    assert.ok(report.checkIns.every((e) => !("minutes" in e.fields)));
    assert.equal(
      f.store
        .list()
        .filter((e) => e.kind === "fact")
        .reduce((n, e) => n + Number(e.fields.minutes ?? 0), 0),
      25,
    );
    assert.equal(f.store.get(session.id)!.version, 1);
    assert.equal(f.store.get(first.checkIn.id)!.fields.outcome, "完成");
  } finally {
    f.close();
  }
});

test("interrupted completion rolls back both item state and fact and retries safely", () => {
  const f = fixture();
  try {
    const item = createLearningTask(f.store, taskInput());
    const original = f.store.saveInTransaction.bind(f.store);
    let calls = 0;
    f.store.saveInTransaction = (...args) => {
      if (++calls === 2)
        throw Error("Injected fictional fact persistence failure");
      return original(...args);
    };
    const input = {
      taskId: item.id,
      expectedVersion: 1,
      operationId: "fictional-failed-completion",
      outcome: "完成" as const,
      occurredAt: at,
    };
    assert.throws(
      () => checkInLearningTask(f.store, input),
      /persistence failure/,
    );
    assert.equal(f.store.get(item.id)!.status, "active");
    assert.equal(f.store.get(item.id)!.version, 1);
    assert.equal(f.store.list().length, 1);
    assert.equal(f.store.audit().length, 1);
    f.store.saveInTransaction = original;
    assert.equal(checkInLearningTask(f.store, input).task.status, "done");
    assert.equal(checkInLearningTask(f.store, input).task.version, 2);
    assert.equal(f.store.list().length, 2);
  } finally {
    f.close();
  }
});

test("same event timestamps retain completion and undo recording order in check-in history", () => {
  const f = fixture();
  try {
    const item = createLearningTask(f.store, taskInput());
    const completed = checkInLearningTask(f.store, {
      taskId: item.id,
      expectedVersion: 1,
      operationId: "fictional-same-event-complete",
      outcome: "完成",
      occurredAt: at,
    });
    const undone = checkInLearningTask(f.store, {
      taskId: item.id,
      expectedVersion: 2,
      operationId: "fictional-same-event-undo",
      outcome: "撤销",
      occurredAt: at,
    });
    const report = reportLearningTasks(f.store.list(), at);
    assert.deepEqual(
      report.checkIns.map((fact) => fact.id),
      [completed.checkIn.id, undone.checkIn.id],
    );
    assert.equal(report.counts.completed, 0);
    assert.equal(report.counts.pending, 1);
    assert.equal(report.counts.checkIns, 2);
  } finally {
    f.close();
  }
});

test("application reminders are only reference-time query records and reports have no writes", () => {
  const f = fixture();
  try {
    const goal = save(f.store, "learning", "goal");
    const material = save(f.store, "learning", "material");
    const item = createLearningTask(f.store, taskInput());
    const pastInput = {
      title: "虚构已到时提醒",
      timeZone: zone,
      occurredAt: start,
      remindAt: "2030-04-08T11:00:00+09:00",
      operationId: "fictional-reminder-due",
      taskId: item.id,
      materialId: material.id,
      goalIds: [goal.id],
    };
    const due = createLearningReminder(f.store, pastInput);
    assert.equal(createLearningReminder(f.store, pastInput).id, due.id);
    const future = createLearningReminder(f.store, {
      ...pastInput,
      title: "虚构之后提醒",
      remindAt: "2030-04-08T13:00:00+09:00",
      operationId: "fictional-reminder-future",
    });
    assert.equal(due.fields.channel, "应用内");
    assert.ok(
      due.relations.some((r) => r.type === "related" && r.target === item.id),
    );
    const before = JSON.stringify(f.store.list());
    const audit = f.store.audit().length;
    const report = reportLearningTasks(f.store.list(), at);
    assert.equal(report.delivery, "in-app-only");
    assert.deepEqual(
      report.reminders.due.map((e) => e.id),
      [due.id],
    );
    assert.deepEqual(
      report.reminders.upcoming.map((e) => e.id),
      [future.id],
    );
    assert.equal(report.reminders.acknowledged.length, 0);
    assert.equal(
      reportLearningTasks(f.store.list(), "2030-04-08T10:00:00+09:00").reminders
        .upcoming.length,
      2,
    );
    assert.equal(
      reportLearningTasks(f.store.list(), "2030-04-08T14:00:00+09:00").reminders
        .due.length,
      2,
    );
    assert.equal(JSON.stringify(f.store.list()), before);
    assert.equal(f.store.audit().length, audit);
  } finally {
    f.close();
  }
});

test("acknowledgment and snooze are explicit versioned actions with durable idempotency", () => {
  const f = fixture();
  try {
    const creation = {
      title: "虚构可调整提醒",
      timeZone: zone,
      occurredAt: start,
      remindAt: at,
      operationId: "fictional-create-reminder",
    };
    const reminder = createLearningReminder(f.store, creation);
    const ack = {
      reminderId: reminder.id,
      expectedVersion: 1,
      operationId: "fictional-ack",
    };
    const done = ackLearningReminder(f.store, ack);
    assert.equal(done.status, "done");
    assert.equal(done.occurredAt, reminder.occurredAt);
    assert.equal(done.source.recordId, reminder.source.recordId);
    assert.equal(done.source.namespace, reminder.source.namespace);
    assert.equal(ackLearningReminder(f.store, ack).version, 2);
    assert.equal(
      reportLearningTasks(f.store.list(), at).reminders.acknowledged.length,
      1,
    );
    const snooze = {
      reminderId: reminder.id,
      expectedVersion: done.version,
      operationId: "fictional-snooze",
      remindAt: "2030-04-08T14:00:00+09:00",
    };
    const later = snoozeLearningReminder(f.store, snooze);
    assert.equal(later.status, "active");
    assert.equal(later.version, 3);
    assert.equal(later.fields.remindAt, snooze.remindAt);
    assert.equal(later.occurredAt, reminder.occurredAt);
    assert.equal(snoozeLearningReminder(f.store, snooze).version, 3);
    assert.equal(ackLearningReminder(f.store, ack).status, "active");
    assert.equal(createLearningReminder(f.store, creation).version, 3);
    assert.throws(
      () =>
        snoozeLearningReminder(f.store, {
          ...snooze,
          remindAt: "2030-04-08T15:00:00+09:00",
        }),
      /reused/,
    );
    assert.throws(
      () =>
        ackLearningReminder(f.store, {
          ...ack,
          expectedVersion: 2,
          operationId: "fictional-stale-ack",
        }),
      /Version conflict/,
    );
    assert.throws(
      () =>
        snoozeLearningReminder(f.store, {
          ...snooze,
          expectedVersion: 3,
          operationId: "fictional-earlier-snooze",
          remindAt: at,
        }),
      /later than/,
    );
    assert.throws(
      () =>
        actOnLearningReminder(f.store, {
          reminderId: reminder.id,
          expectedVersion: 3,
          operationId: "fictional-ack-changes-time",
          action: "ack",
          remindAt: at,
        }),
      /cannot change/,
    );
    assert.equal(
      reportLearningTasks(f.store.list(), at).reminders.upcoming.length,
      1,
    );
  } finally {
    f.close();
  }
});

test("explicit timestamp offsets resolve DST folds and reject gaps, false offsets and invalid calendar dates", () => {
  assert.throws(
    () =>
      validateLearningTimestamp(
        "2030-03-10T02:30:00-05:00",
        "America/New_York",
      ),
    /does not match/,
  );
  assert.throws(
    () => validateLearningTimestamp("2030-11-03T01:30:00", "America/New_York"),
    /explicit-offset/,
  );
  const early = validateLearningTimestamp(
    "2030-11-03T01:30:00-04:00",
    "America/New_York",
  );
  const late = validateLearningTimestamp(
    "2030-11-03T01:30:00-05:00",
    "America/New_York",
  );
  assert.equal(late - early, 3600000);
  for (const invalid of [
    "2030-02-30T09:00:00+09:00",
    "2030-04-08T24:00:00+09:00",
    "2030-04-08T09:60:00+09:00",
    "2030-04-08T09:00:60+09:00",
    "2030-04-08T09:00:00+14:01",
    "2030-04-08",
  ])
    assert.throws(() => validateLearningTimestamp(invalid));
  assert.throws(
    () => validateLearningTimestamp("2030-04-08T09:00:00Z", zone),
    /does not match/,
  );
  const f = fixture();
  try {
    const before = f.store.audit().length;
    assert.throws(
      () =>
        createLearningTask(f.store, taskInput({ due: "2030-04-08T12:00:00Z" })),
      /does not match/,
    );
    assert.throws(
      () =>
        createLearningReminder(f.store, {
          title: "虚构无效提醒",
          timeZone: "America/New_York",
          remindAt: "2030-03-10T02:30:00-05:00",
          operationId: "fictional-gap",
        }),
      /does not match/,
    );
    assert.equal(f.store.audit().length, before);
    assert.equal(f.store.list().length, 0);
  } finally {
    f.close();
  }
});

test("non-UTC tasks, check-ins and reminders generate matching default event offsets and retry the original instant", () => {
  const f = fixture();
  try {
    for (const timeZone of ["Asia/Shanghai", "Asia/Tokyo"]) {
      const before = Date.now();
      const creation = taskInput({
        timeZone,
        occurredAt: undefined,
        due: undefined,
        operationId: `fictional-local-create-${timeZone.split("/")[1]}`,
      });
      const item = createLearningTask(f.store, creation);
      const instant = validateLearningTimestamp(item.occurredAt, timeZone);
      assert.ok(instant >= before - 1000 && instant <= Date.now());
      assert.ok(
        item.occurredAt.endsWith(
          timeZone === "Asia/Shanghai" ? "+08:00" : "+09:00",
        ),
      );
      assert.equal(
        createLearningTask(f.store, creation).occurredAt,
        item.occurredAt,
      );
      const checkInInput = {
        taskId: item.id,
        expectedVersion: 1,
        operationId: `fictional-local-checkin-${timeZone.split("/")[1]}`,
        outcome: "完成" as const,
      };
      const completed = checkInLearningTask(f.store, checkInInput);
      validateLearningTimestamp(completed.checkIn.occurredAt, timeZone);
      assert.equal(
        checkInLearningTask(f.store, checkInInput).checkIn.occurredAt,
        completed.checkIn.occurredAt,
      );
      const reminderInput = {
        title: "虚构本地事件时间提醒",
        timeZone,
        remindAt:
          timeZone === "Asia/Shanghai" ? "2030-04-08T12:00:00+08:00" : at,
        operationId: `fictional-local-reminder-${timeZone.split("/")[1]}`,
      };
      const reminder = createLearningReminder(f.store, reminderInput);
      validateLearningTimestamp(reminder.occurredAt, timeZone);
      assert.equal(
        createLearningReminder(f.store, reminderInput).occurredAt,
        reminder.occurredAt,
      );
    }
  } finally {
    f.close();
  }
});

test("invalid goal/material linkage and non-human commands produce zero writes", () => {
  const f = fixture();
  try {
    const review = save(f.store, "learning", "review");
    const done = save(f.store, "learning", "goal", {}, { status: "done" });
    const factual = save(f.store, "planning", "goal", {}, { kind: "fact" });
    const deleted = save(f.store, "projects", "goal", {}, { deleted: true });
    const goal = save(f.store, "learning", "goal");
    const before = f.store.audit().length;
    for (const candidate of [
      review.id,
      done.id,
      factual.id,
      deleted.id,
      "fictional-missing-goal",
    ])
      assert.throws(
        () => createLearningTask(f.store, taskInput({ goalIds: [candidate] })),
        /active domain goal/,
      );
    assert.throws(
      () =>
        createLearningTask(f.store, taskInput({ goalIds: [goal.id, goal.id] })),
      /duplicate/,
    );
    assert.throws(
      () => createLearningTask(f.store, taskInput({ materialId: review.id })),
      /learning\/material/,
    );
    const ai = {
      actor: "fictional-agent",
      role: "ai" as const,
      read: ["*"],
      write: ["*"],
      suggest: ["*"],
    };
    assert.throws(
      () => createLearningTask(f.store, taskInput(), ai),
      /human capability/,
    );
    assert.throws(
      () =>
        checkInLearningTask(
          f.store,
          {
            taskId: goal.id,
            expectedVersion: 1,
            operationId: "fictional-ai-checkin",
            outcome: "完成",
          },
          ai,
        ),
      /human capability/,
    );
    assert.equal(f.store.audit().length, before);
    assert.equal(f.store.list().filter((e) => e.type === "check-in").length, 0);
    const created = createLearningTask(f.store, taskInput());
    assert.throws(
      () =>
        createLearningReminder(f.store, {
          title: "虚构不同命令",
          timeZone: zone,
          remindAt: at,
          operationId: "fictional-create-task",
        }),
      /reused/,
    );
    assert.equal(f.store.get(created.id)!.version, 1);
  } finally {
    f.close();
  }
});

test("report keeps invalid reminders visible and does not assign ambiguous check-in facts", () => {
  const f = fixture();
  try {
    const item = createLearningTask(f.store, taskInput());
    const invalid = save(f.store, "learning", "reminder", {
      channel: "应用内",
      remindAt: "2030-04-08T12:00:00Z",
    });
    const fact = save(
      f.store,
      "learning",
      "check-in",
      { outcome: "完成" },
      {
        kind: "fact",
        status: "done",
        relations: [
          { type: "actual-of", target: item.id },
          { type: "evidence", target: invalid.id },
        ],
      },
    );
    const report = reportLearningTasks(f.store.list(), at);
    assert.deepEqual(
      report.reminders.invalid.map((e) => e.id),
      [invalid.id],
    );
    assert.equal(report.reminders.due.length, 0);
    assert.deepEqual(report.tasks[0].checkInIds, []);
    assert.ok(
      report.issues.some(
        (issue) => issue.entityId === fact.id && issue.message.includes("唯一"),
      ),
    );
    assert.ok(report.issues.some((issue) => issue.entityId === invalid.id));
    assert.throws(
      () => reportLearningTasks(f.store.list(), "2030-04-08T12:00:00"),
      /explicit-offset/,
    );
  } finally {
    f.close();
  }
});

test("restart and full backup restore preserve checklist/check-in history, reminders and command idempotency", () => {
  const f = fixture();
  let restored: Store | undefined;
  let restarted: Store | undefined;
  try {
    const goal = save(f.store, "learning", "goal");
    const creation = taskInput({ goalIds: [goal.id] });
    const item = createLearningTask(f.store, creation);
    const completion = {
      taskId: item.id,
      expectedVersion: 1,
      operationId: "fictional-backup-complete",
      outcome: "完成" as const,
      occurredAt: at,
    };
    const first = checkInLearningTask(f.store, completion);
    const undo = {
      ...completion,
      expectedVersion: 2,
      operationId: "fictional-backup-undo",
      outcome: "撤销" as const,
      occurredAt: "2030-04-08T12:05:00+09:00",
    };
    const undone = checkInLearningTask(f.store, undo);
    const reminder = createLearningReminder(f.store, {
      title: "虚构恢复提醒",
      timeZone: zone,
      occurredAt: start,
      remindAt: at,
      taskId: item.id,
      operationId: "fictional-backup-reminder",
    });
    const acknowledge = {
      reminderId: reminder.id,
      expectedVersion: 1,
      operationId: "fictional-backup-ack",
    };
    ackLearningReminder(f.store, acknowledge);
    const backup = f.store.backup();
    restored = Store.restore(join(f.root, "restored"), backup);
    restarted = new Store(f.store.root);
    for (const store of [restored, restarted]) {
      const before = store.audit().length;
      assert.equal(createLearningTask(store, creation).id, item.id);
      assert.equal(
        checkInLearningTask(store, completion).checkIn.id,
        first.checkIn.id,
      );
      assert.equal(
        checkInLearningTask(store, undo).checkIn.id,
        undone.checkIn.id,
      );
      assert.equal(store.get(item.id)!.status, "active");
      assert.equal(ackLearningReminder(store, acknowledge).status, "done");
      const report = reportLearningTasks(store.list(), at);
      assert.deepEqual(report.counts, {
        total: 1,
        completed: 0,
        pending: 1,
        checkIns: 2,
      });
      assert.equal(report.reminders.acknowledged[0].id, reminder.id);
      assert.equal(store.audit().length, before);
      assert.equal(store.get(item.id)!.body, item.body);
      assert.equal(store.get(item.id)!.occurredAt, item.occurredAt);
      assert.deepEqual(store.get(item.id)!.source, item.source);
    }
  } finally {
    restarted?.close();
    restored?.close();
    f.close();
  }
});
