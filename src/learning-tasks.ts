import type { Store } from "./store.js";
import {
  HUMAN,
  type Capability,
  type Entity,
  type EntityInput,
  type Operation,
  type Source,
} from "./types.js";
import { hash } from "./vault.js";
import {
  learningClock as localClock,
  validateLearningTimestamp,
} from "./learning-time.js";
export { validateLearningTimestamp } from "./learning-time.js";

type Linked = {
  goalIds?: string[];
  materialId?: string;
  evidenceIds?: string[];
};
export type LearningTaskInput = Linked & {
  title: string;
  timeZone: string;
  occurredAt?: string;
  due?: string;
  focus?: string;
  body?: string;
  operationId: string;
};
export type LearningCheckInInput = {
  taskId: string;
  expectedVersion: number;
  operationId: string;
  outcome: "完成" | "撤销";
  note?: string;
  occurredAt?: string;
  timeZone?: string;
};
export type LearningReminderInput = Linked & {
  title: string;
  remindAt: string;
  timeZone: string;
  occurredAt?: string;
  body?: string;
  taskId?: string;
  operationId: string;
};
export type LearningReminderActionInput = {
  reminderId: string;
  expectedVersion: number;
  operationId: string;
  action: "ack" | "snooze";
  remindAt?: string;
  timeZone?: string;
};
export type LearningTaskRow = {
  id: string;
  title: string;
  status: Entity["status"];
  due?: string;
  goalIds: string[];
  materialIds: string[];
  checkInIds: string[];
};
export type LearningTasksReport = {
  kind: "inference";
  ruleVersion: "learning-tasks-v1";
  source: Source;
  asOf: string;
  delivery: "in-app-only";
  tasks: LearningTaskRow[];
  checkIns: Entity[];
  counts: {
    total: number;
    completed: number;
    pending: number;
    checkIns: number;
  };
  reminders: {
    due: Entity[];
    upcoming: Entity[];
    acknowledged: Entity[];
    invalid: Entity[];
  };
  goalViews: {
    goalId: string;
    title: string;
    taskIds: string[];
    completed: number;
    pending: number;
  }[];
  issues: { entityId: string; message: string }[];
};

const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 1000;
const id = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
};
function timestamp(value: string | undefined, timeZone: string) {
  if (!nonempty(timeZone)) throw Error("Explicit IANA time zone is required");
  if (value !== undefined) {
    validateLearningTimestamp(value, timeZone);
    return value;
  }
  const instant = Date.now();
  const wholeSecond = Math.floor(instant / 1000) * 1000;
  const local = localClock(instant, timeZone);
  const minutes = (Date.parse(local + "Z") - wholeSecond) / 60000;
  const absolute = Math.abs(minutes);
  return `${local}.${String(instant % 1000).padStart(3, "0")}${minutes < 0 ? "-" : "+"}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}
function command(
  store: Store,
  name: string,
  input: { operationId: string },
  cap: Capability,
) {
  if (cap.role !== "human")
    throw Error(
      "Learning commands require a human capability; AI cannot mark facts or confirmed plans",
    );
  store.permit(cap, "write", "learning");
  if (!input || !id(input.operationId))
    throw Error("A stable learning operationId is required");
  const operationId = hash("learning-command|" + input.operationId);
  const digest = hash(JSON.stringify(canonical({ name, input })));
  const row = store.db
    .prepare("SELECT json FROM operations WHERE id=?")
    .get(operationId);
  const prior = row ? (JSON.parse(String(row.json)) as Operation) : undefined;
  if (prior) {
    const current = store.get(prior.entityId, cap);
    if (
      !current ||
      prior.value.module !== "learning" ||
      prior.value.source.revision !== digest
    )
      throw Error("Learning operationId reused with different content");
    return { operationId, digest, prior, current };
  }
  return { operationId, digest };
}
const source = (
  operationId: string,
  digest: string,
  namespace: string,
): Source => ({
  namespace,
  recordId: operationId,
  revision: digest,
  mode: "manual",
});
function entityInput(entity: Entity): EntityInput {
  return {
    id: entity.id,
    module: entity.module,
    type: entity.type,
    title: entity.title,
    kind: entity.kind,
    status: entity.status,
    occurredAt: entity.occurredAt,
    timeZone: entity.timeZone,
    fields: { ...entity.fields },
    relations: [...entity.relations],
    body: entity.body,
    source: { ...entity.source },
    deleted: entity.deleted,
  };
}
function linkedRelations(store: Store, input: Linked, cap: Capability) {
  const relations: EntityInput["relations"] = [];
  const list = (ids: string[] | undefined) => {
    if (
      ids !== undefined &&
      (!Array.isArray(ids) ||
        ids.length > 30 ||
        ids.some((value) => !id(value)) ||
        new Set(ids).size !== ids.length)
    )
      throw Error("Invalid or duplicate learning relation IDs");
    return ids ?? [];
  };
  for (const goalId of list(input.goalIds)) {
    const goal = store.get(goalId, cap);
    if (
      !goal ||
      goal.deleted ||
      goal.kind !== "plan" ||
      goal.status !== "active" ||
      !(
        goal.type === "goal" ||
        (goal.module === "planning" && goal.type === "direction") ||
        (goal.module === "languages" && goal.type === "language-goal")
      )
    )
      throw Error(
        "Learning goal must be an existing active domain goal or direction",
      );
    relations.push({ type: "supports", target: goalId });
  }
  if (input.materialId !== undefined) {
    if (!id(input.materialId)) throw Error("Invalid learning material ID");
    const material = store.get(input.materialId, cap);
    if (
      !material ||
      material.deleted ||
      material.module !== "learning" ||
      material.type !== "material"
    )
      throw Error("Learning material must be an existing learning/material");
    relations.push({ type: "evidence", target: material.id });
  }
  for (const evidenceId of list(input.evidenceIds)) {
    const evidence = store.get(evidenceId, cap);
    if (!evidence || evidence.deleted)
      throw Error("Unknown or deleted learning evidence");
    if (
      !relations.some((r) => r.type === "evidence" && r.target === evidenceId)
    )
      relations.push({ type: "evidence", target: evidenceId });
  }
  return relations;
}
function words(title: string, body: string | undefined) {
  if (
    !nonempty(title) ||
    (body !== undefined && (typeof body !== "string" || body.length > 100000))
  )
    throw Error("Invalid learning title or body");
}
function task(store: Store, taskId: string, cap: Capability) {
  if (!id(taskId)) throw Error("Invalid learning task ID");
  const item = store.get(taskId, cap);
  if (
    !item ||
    item.deleted ||
    item.module !== "learning" ||
    item.type !== "checklist-item" ||
    item.kind !== "plan" ||
    !["active", "done"].includes(item.status)
  )
    throw Error("Unknown or invalid learning checklist item");
  return item;
}
function version(expectedVersion: number, current: Entity) {
  if (
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 1 ||
    expectedVersion !== current.version
  )
    throw Error("Version conflict: reload the learning record before acting");
}

export function createLearningTask(
  store: Store,
  input: LearningTaskInput,
  cap = HUMAN,
): Entity {
  const receipt = command(store, "create-task", input, cap);
  if (receipt.current) return receipt.current;
  words(input.title, input.body);
  if (
    input.focus !== undefined &&
    (typeof input.focus !== "string" || input.focus.length > 1000)
  )
    throw Error("Invalid learning focus");
  const occurredAt = timestamp(input.occurredAt, input.timeZone);
  if (input.due !== undefined)
    validateLearningTimestamp(input.due, input.timeZone);
  const relations = linkedRelations(store, input, cap);
  return store.save(
    {
      expectedVersion: 0,
      operationId: receipt.operationId,
      entity: {
        id: hash("learning-entity|" + receipt.operationId),
        module: "learning",
        type: "checklist-item",
        title: input.title,
        kind: "plan",
        status: "active",
        occurredAt,
        timeZone: input.timeZone,
        fields: {
          ...(input.due !== undefined ? { due: input.due } : {}),
          ...(input.focus !== undefined ? { focus: input.focus } : {}),
        },
        relations,
        body: input.body ?? "",
        source: source(
          input.operationId,
          receipt.digest,
          "learning-task-command",
        ),
      },
    },
    cap,
  );
}

export function checkInLearningTask(
  store: Store,
  input: LearningCheckInInput,
  cap = HUMAN,
): { task: Entity; checkIn: Entity } {
  const receipt = command(store, "check-in", input, cap);
  if (receipt.current)
    return { task: task(store, input.taskId, cap), checkIn: receipt.current };
  const item = task(store, input.taskId, cap);
  version(input.expectedVersion, item);
  if (
    !["完成", "撤销"].includes(input.outcome) ||
    (input.note !== undefined &&
      (typeof input.note !== "string" || input.note.length > 10000))
  )
    throw Error("Invalid learning check-in outcome or note");
  if (
    (input.outcome === "完成" && item.status !== "active") ||
    (input.outcome === "撤销" && item.status !== "done")
  )
    throw Error(
      "Check-in state conflict: complete active items; undo completed items",
    );
  const timeZone = input.timeZone ?? item.timeZone;
  const occurredAt = timestamp(input.occurredAt, timeZone);
  const checkInId = hash("learning-entity|" + receipt.operationId);
  const updated = entityInput(item);
  updated.status = input.outcome === "完成" ? "done" : "active";
  // Preserve the task's original event and source; each check-in has its own provenance.
  const [updatedTask, checkIn] = store.saveMany(
    [
      {
        expectedVersion: input.expectedVersion,
        expectedNoteHash: item.noteHash,
        operationId: hash(receipt.operationId + "|task-state"),
        entity: updated,
      },
      {
        expectedVersion: 0,
        operationId: receipt.operationId,
        entity: {
          id: checkInId,
          module: "learning",
          type: "check-in",
          title: `${input.outcome} · ${item.title}`,
          kind: "fact",
          status: "done",
          occurredAt,
          timeZone,
          fields: {
            outcome: input.outcome,
            ...(input.note !== undefined ? { note: input.note } : {}),
          },
          relations: [{ type: "actual-of", target: item.id }],
          body: input.note ?? "",
          source: source(
            input.operationId,
            receipt.digest,
            "learning-check-in-command",
          ),
        },
      },
    ],
    cap,
  );
  return { task: updatedTask, checkIn };
}

export function createLearningReminder(
  store: Store,
  input: LearningReminderInput,
  cap = HUMAN,
): Entity {
  const receipt = command(store, "create-reminder", input, cap);
  if (receipt.current) return receipt.current;
  words(input.title, input.body);
  validateLearningTimestamp(input.remindAt, input.timeZone);
  const occurredAt = timestamp(input.occurredAt, input.timeZone);
  const relations = linkedRelations(store, input, cap);
  if (input.taskId !== undefined)
    relations.push({
      type: "related",
      target: task(store, input.taskId, cap).id,
    });
  return store.save(
    {
      expectedVersion: 0,
      operationId: receipt.operationId,
      entity: {
        id: hash("learning-entity|" + receipt.operationId),
        module: "learning",
        type: "reminder",
        title: input.title,
        kind: "plan",
        status: "active",
        occurredAt,
        timeZone: input.timeZone,
        fields: { remindAt: input.remindAt, channel: "应用内" },
        relations,
        body: input.body ?? "",
        source: source(
          input.operationId,
          receipt.digest,
          "learning-reminder-command",
        ),
      },
    },
    cap,
  );
}

export function actOnLearningReminder(
  store: Store,
  input: LearningReminderActionInput,
  cap = HUMAN,
): Entity {
  const receipt = command(store, "reminder-action", input, cap);
  if (receipt.current) return receipt.current;
  if (!id(input.reminderId)) throw Error("Invalid learning reminder ID");
  const reminder = store.get(input.reminderId, cap);
  if (
    !reminder ||
    reminder.deleted ||
    reminder.module !== "learning" ||
    reminder.type !== "reminder" ||
    reminder.kind !== "plan"
  )
    throw Error("Unknown learning reminder");
  version(input.expectedVersion, reminder);
  if (!["ack", "snooze"].includes(input.action))
    throw Error("Invalid reminder action");
  if (
    input.action === "ack" &&
    (input.remindAt !== undefined || input.timeZone !== undefined)
  )
    throw Error("Acknowledgment cannot change the reminder time");
  if (input.action === "ack" && reminder.status !== "active")
    throw Error("Reminder already acknowledged");
  const updated = entityInput(reminder);
  if (input.action === "snooze") {
    const zone = input.timeZone ?? reminder.timeZone;
    if (!input.remindAt)
      throw Error("Snooze requires an explicit new reminder timestamp");
    const proposed = validateLearningTimestamp(input.remindAt, zone);
    const original = validateLearningTimestamp(
      String(reminder.fields.remindAt),
      reminder.timeZone,
    );
    if (proposed <= original)
      throw Error("Snooze time must be later than the current reminder time");
    updated.fields.remindAt = input.remindAt;
    // Event provenance stays in the original zone; use that zone for all reminder timestamps.
    if (zone !== reminder.timeZone)
      throw Error("Snooze must preserve the reminder IANA time zone");
    updated.status = "active";
  } else updated.status = "done";
  updated.source = { ...reminder.source, revision: receipt.digest };
  return store.save(
    {
      expectedVersion: input.expectedVersion,
      expectedNoteHash: reminder.noteHash,
      operationId: receipt.operationId,
      entity: updated,
    },
    cap,
  );
}
export function ackLearningReminder(
  store: Store,
  input: Omit<LearningReminderActionInput, "action" | "remindAt" | "timeZone">,
  cap = HUMAN,
) {
  return actOnLearningReminder(store, { ...input, action: "ack" }, cap);
}
export function snoozeLearningReminder(
  store: Store,
  input: Omit<LearningReminderActionInput, "action"> & { remindAt: string },
  cap = HUMAN,
) {
  return actOnLearningReminder(store, { ...input, action: "snooze" }, cap);
}

export function reportLearningTasks(
  entities: Entity[],
  asOf: string,
): LearningTasksReport {
  const now = validateLearningTimestamp(asOf);
  const unique = new Map<string, Entity>();
  for (const entity of entities) {
    const known = unique.get(entity.id);
    if (!known || entity.version > known.version) unique.set(entity.id, entity);
  }
  const all = [...unique.values()].filter((e) => !e.deleted);
  const items = all.filter(
    (e) =>
      e.module === "learning" &&
      e.type === "checklist-item" &&
      e.kind === "plan",
  );
  const checkIns = all
    .filter(
      (e) =>
        e.module === "learning" && e.type === "check-in" && e.kind === "fact",
    )
    .sort(
      (a, b) =>
        Date.parse(a.occurredAt) - Date.parse(b.occurredAt) ||
        Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
  const issues: LearningTasksReport["issues"] = [];
  const targets = (entity: Entity, relation: string) => [
    ...new Set(
      entity.relations.filter((r) => r.type === relation).map((r) => r.target),
    ),
  ];
  const itemIds = new Set(items.map((e) => e.id));
  for (const checkIn of checkIns) {
    const links = [
      ...new Set([
        ...targets(checkIn, "actual-of"),
        ...targets(checkIn, "evidence"),
      ]),
    ];
    if (links.length !== 1 || !itemIds.has(links[0]))
      issues.push({
        entityId: checkIn.id,
        message: "打卡缺少唯一清单任务关联，未归入任务历史。",
      });
    if (!["完成", "撤销"].includes(String(checkIn.fields.outcome)))
      issues.push({
        entityId: checkIn.id,
        message: "打卡结果无效，请核对原始记录。",
      });
  }
  const tasks = items.map((item): LearningTaskRow => {
    const due =
      typeof item.fields.due === "string" ? item.fields.due : undefined;
    if (due)
      try {
        validateLearningTimestamp(due, item.timeZone);
      } catch (error) {
        issues.push({
          entityId: item.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    if (!["active", "done"].includes(item.status))
      issues.push({
        entityId: item.id,
        message: "清单状态尚未确认或异常，未计入已完成。",
      });
    const goalIds = targets(item, "supports");
    for (const goalId of goalIds)
      if (!unique.get(goalId) || unique.get(goalId)!.deleted)
        issues.push({
          entityId: item.id,
          message: `关联目标 ${goalId} 当前不可用，保留原始关联。`,
        });
    return {
      id: item.id,
      title: item.title,
      status: item.status,
      ...(due ? { due } : {}),
      goalIds,
      materialIds: targets(item, "evidence").filter((id) => {
        const e = unique.get(id);
        return e?.module === "learning" && e.type === "material";
      }),
      checkInIds: checkIns
        .filter((e) => {
          const links = [
            ...new Set([...targets(e, "actual-of"), ...targets(e, "evidence")]),
          ];
          return links.length === 1 && links[0] === item.id;
        })
        .map((e) => e.id),
    };
  });
  const reminders: LearningTasksReport["reminders"] = {
    due: [],
    upcoming: [],
    acknowledged: [],
    invalid: [],
  };
  for (const reminder of all.filter(
    (e) =>
      e.module === "learning" && e.type === "reminder" && e.kind === "plan",
  )) {
    try {
      if (
        reminder.fields.channel !== "应用内" ||
        !["active", "done"].includes(reminder.status)
      )
        throw Error("仅支持已确认的应用内提醒记录");
      const at = validateLearningTimestamp(
        String(reminder.fields.remindAt),
        reminder.timeZone,
      );
      if (reminder.status === "done") reminders.acknowledged.push(reminder);
      else (at <= now ? reminders.due : reminders.upcoming).push(reminder);
    } catch (error) {
      reminders.invalid.push(reminder);
      issues.push({
        entityId: reminder.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  for (const list of Object.values(reminders))
    list.sort(
      (a, b) =>
        Date.parse(String(a.fields.remindAt)) -
          Date.parse(String(b.fields.remindAt)) || a.id.localeCompare(b.id),
    );
  const goalIds = [...new Set(tasks.flatMap((t) => t.goalIds))];
  const goalViews = goalIds.map((goalId) => {
    const linked = tasks.filter((t) => t.goalIds.includes(goalId));
    const completed = linked.filter((t) => t.status === "done").length;
    return {
      goalId,
      title: unique.get(goalId)?.title ?? goalId,
      taskIds: linked.map((t) => t.id),
      completed,
      pending: linked.length - completed,
    };
  });
  const completed = tasks.filter((t) => t.status === "done").length;
  return {
    kind: "inference",
    ruleVersion: "learning-tasks-v1",
    source: {
      namespace: "learning-task-report",
      recordId: hash(JSON.stringify(canonical({ asOf, entities: all }))),
      revision: "learning-tasks-v1",
      mode: "rule",
    },
    asOf,
    delivery: "in-app-only",
    tasks,
    checkIns,
    counts: {
      total: tasks.length,
      completed,
      pending: tasks.length - completed,
      checkIns: checkIns.length,
    },
    reminders,
    goalViews,
    issues,
  };
}
