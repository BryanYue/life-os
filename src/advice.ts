import { Store } from "./store.js";
import { readingReport } from "./reading.js";
import { hash } from "./vault.js";
import { HUMAN, type Capability, type Entity, type Source } from "./types.js";

export const ADVICE_RULE_VERSION = "local-advice-v1";
export type AdviceSuggestion = {
  id: string;
  kind: "inference";
  ruleVersion: string;
  ruleId:
    "goal-record-gap" | "reading-vocabulary-review" | "overdue-plan-review";
  source: Source;
  goalIds: string[];
  evidenceIds: string[];
  explanation: string;
  title: string;
  proposedTask: {
    title: string;
    goalIds: string[];
    materialId?: string;
    body?: string;
  };
};
export type AdviceReport = {
  asOf: string;
  days: number;
  ruleVersion: typeof ADVICE_RULE_VERSION;
  suggestions: AdviceSuggestion[];
  issues: { entityId?: string; code: string; message: string }[];
};
export type AdoptAdviceRequest = {
  adviceId: string;
  asOf: string;
  days?: number;
  operationId?: string;
  task?: {
    title?: string;
    body?: string;
    due?: string;
    focus?: string;
    timeZone?: string;
  };
};
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonical(item)]),
        )
      : value;
const digest = (value: unknown) => hash(JSON.stringify(canonical(value)));
const unique = (values: string[]) => [...new Set(values)].sort();
function iso(value: string, dateEnd = false): number {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(
      value,
    )
  )
    throw Error("Use an ISO calendar date or an offset-aware timestamp");
  if (value.length > 10) {
    const clock = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(
      value,
    )!;
    const offset = /[+-](\d{2}):(\d{2})$/.exec(value);
    if (
      Number(clock[1]) > 23 ||
      Number(clock[2]) > 59 ||
      Number(clock[3] ?? 0) > 59 ||
      (offset &&
        (Number(offset[1]) > 14 ||
          Number(offset[2]) > 59 ||
          (Number(offset[1]) === 14 && Number(offset[2]) !== 0)))
    )
      throw Error("Invalid ISO time or UTC offset");
  }
  const at = Date.parse(value);
  if (
    !Number.isFinite(at) ||
    new Date(Date.parse(value.slice(0, 10))).toISOString().slice(0, 10) !==
      value.slice(0, 10)
  )
    throw Error("Invalid calendar date");
  return at + (dateEnd && value.length === 10 ? 86_400_000 - 1 : 0);
}
function window(asOf: string, days: number) {
  if (!Number.isSafeInteger(days) || days < 1 || days > 366)
    throw Error("Advice window must contain 1–366 days");
  const at = iso(asOf, true);
  return { at, from: at - days * 86_400_000, asOf: new Date(at).toISOString() };
}
function activeGoal(entity: Entity) {
  return (
    entity.kind === "plan" &&
    entity.status === "active" &&
    (entity.type === "goal" ||
      (entity.module === "planning" && entity.type === "direction") ||
      (entity.module === "languages" && entity.type === "language-goal"))
  );
}
function targets(entity: Entity, type: string) {
  return unique(
    entity.relations
      .filter((relation) => relation.type === type)
      .map((relation) => relation.target),
  );
}
function batches<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
}

/** Transparent local suggestions. No writes, model calls, scheduling or external actions. */
export function generateAdvice(
  entities: Entity[],
  asOf: string,
  days = 7,
): AdviceReport {
  const range = window(asOf, days);
  const issues: AdviceReport["issues"] = [];
  const selected = new Map<string, Entity>();
  for (const entity of entities) {
    const prior = selected.get(entity.id);
    if (
      !prior ||
      entity.version > prior.version ||
      (entity.version === prior.version && entity.deleted)
    )
      selected.set(entity.id, entity);
  }
  const current = [...selected.values()]
    .filter((entity) => !entity.deleted)
    .sort((a, b) => a.id.localeCompare(b.id));
  const visible = current.filter((entity) => {
    try {
      if (
        !entity.source?.namespace ||
        !entity.source.recordId ||
        !entity.source.revision ||
        !Number.isSafeInteger(entity.version) ||
        entity.version < 1
      )
        throw Error("Record has incomplete source or version metadata");
      return iso(entity.occurredAt) <= range.at;
    } catch (error) {
      issues.push({
        entityId: entity.id,
        code: "invalid-advice-record",
        message: String(error),
      });
      return false;
    }
  });
  const lookup = new Map(visible.map((entity) => [entity.id, entity]));
  const goals = visible.filter(activeGoal),
    goalIds = new Set(goals.map((goal) => goal.id));
  const reading = readingReport(visible);
  issues.push(...reading.issues);
  const invalidReadingIds = new Set(
    reading.issues.map((issue) => issue.entityId),
  );
  for (const entity of visible) {
    for (const relation of entity.relations) {
      if (
        ["supports", "evidence", "actual-of"].includes(relation.type) &&
        !lookup.has(relation.target)
      )
        issues.push({
          entityId: entity.id,
          code: "unavailable-advice-reference",
          message: "忽略缺失、已删除或未来记录关系：" + relation.target,
        });
    }
  }
  const supportedGoals = (entity: Entity): string[] => {
    const direct = targets(entity, "supports").filter((id) => goalIds.has(id));
    const actualOf = targets(entity, "actual-of");
    // An actual related to several plans cannot prove progress for a selected one.
    const plan = actualOf.length === 1 ? lookup.get(actualOf[0]) : undefined;
    return unique([
      ...direct,
      ...(plan?.kind === "plan"
        ? targets(plan, "supports").filter((id) => goalIds.has(id))
        : []),
    ]);
  };
  const pendingTasks = visible.filter(
    (entity) =>
      entity.module === "learning" &&
      entity.type === "checklist-item" &&
      entity.kind === "plan" &&
      entity.status === "active",
  );
  const suggestions: AdviceSuggestion[] = [];
  const add = (
    ruleId: AdviceSuggestion["ruleId"],
    title: string,
    explanation: string,
    selectedGoals: string[],
    evidenceIds: string[],
    taskTitle: string,
    materialId?: string,
  ) => {
    const relatedGoalIds = unique(selectedGoals).filter((id) =>
      goalIds.has(id),
    );
    const relatedEvidenceIds = unique(evidenceIds).filter((id) =>
      lookup.has(id),
    );
    const dependencies = unique([
      ...relatedGoalIds,
      ...relatedEvidenceIds,
      ...(materialId ? [materialId] : []),
    ]).map((id) => lookup.get(id)!);
    const id = digest({
      ruleVersion: ADVICE_RULE_VERSION,
      ruleId,
      asOf: range.asOf,
      days,
      dependencies,
    });
    suggestions.push({
      id,
      kind: "inference",
      ruleVersion: ADVICE_RULE_VERSION,
      ruleId,
      source: {
        namespace: "local-advice-rule",
        recordId: id,
        revision: ADVICE_RULE_VERSION,
        mode: "rule",
      },
      goalIds: relatedGoalIds,
      evidenceIds: relatedEvidenceIds,
      title,
      explanation,
      proposedTask: {
        title: taskTitle,
        goalIds: relatedGoalIds,
        ...(materialId ? { materialId } : {}),
        body: explanation,
      },
    });
  };
  const observed = new Set<string>();
  for (const entity of visible) {
    if (
      entity.kind !== "fact" ||
      iso(entity.occurredAt) < range.from ||
      invalidReadingIds.has(entity.id)
    )
      continue;
    for (const id of supportedGoals(entity)) observed.add(id);
  }
  const pendingGoalIds = new Set(pendingTasks.flatMap(supportedGoals));
  const gaps = goals.filter(
    (goal) => !observed.has(goal.id) && !pendingGoalIds.has(goal.id),
  );
  for (const group of batches(gaps, 20)) {
    const names = group.map((goal) => goal.title).join("、");
    add(
      "goal-record-gap",
      "回看目标，选择一个可记录的小步",
      `截至 ${range.asOf}，最近 ${days} 天未找到明确支持这些活动目标的本地事实记录：${names}。没有记录不等于未完成，也不表示目标失败。可先补录已经发生的活动，或自行选择材料与下一小步；这是对记录的提醒，不是健康、投资或联系他人的建议。`,
      group.map((goal) => goal.id),
      [],
      "回看目标并记录一个自选小步",
    );
  }
  const usableSessions = new Map(
    reading.sessions
      .filter(
        (session) =>
          session.counted &&
          session.materialId &&
          !invalidReadingIds.has(session.entity.id) &&
          !invalidReadingIds.has(session.materialId),
      )
      .map((session) => [session.entity.id, session]),
  );
  const vocabularyByMaterial = new Map<string, typeof reading.vocabulary>();
  for (const item of reading.vocabulary) {
    if (
      item.entity.kind !== "fact" ||
      item.entity.status !== "active" ||
      !item.materialId ||
      !item.sessionId ||
      invalidReadingIds.has(item.entity.id) ||
      !usableSessions.has(item.sessionId)
    )
      continue;
    const session = usableSessions.get(item.sessionId)!;
    if (session.materialId !== item.materialId) {
      issues.push({
        entityId: item.entity.id,
        code: "reading-advice-source-mismatch",
        message: "词汇原文与阅读记录原文不一致，未生成建议。",
      });
      continue;
    }
    if (item.entity.fields.due !== undefined) {
      try {
        if (iso(String(item.entity.fields.due), true) > range.at) continue;
      } catch (error) {
        issues.push({
          entityId: item.entity.id,
          code: "invalid-advice-due",
          message: String(error),
        });
        continue;
      }
    }
    if (
      pendingTasks.some((task) =>
        targets(task, "evidence").includes(item.entity.id),
      )
    )
      continue;
    const group = vocabularyByMaterial.get(item.materialId) ?? [];
    group.push(item);
    vocabularyByMaterial.set(item.materialId, group);
  }
  for (const [materialId, entries] of vocabularyByMaterial) {
    const material = lookup.get(materialId)!;
    for (const group of batches(entries, 10)) {
      const sessions = unique(group.map((item) => item.sessionId!));
      const relevantGoals = unique([
        ...supportedGoals(material),
        ...group.flatMap((item) => supportedGoals(item.entity)),
        ...sessions.flatMap((id) => supportedGoals(lookup.get(id)!)),
      ]);
      const terms = group
        .map((item) =>
          String(
            item.entity.fields.term ??
              item.entity.fields.prompt ??
              item.entity.title,
          ),
        )
        .join("、");
      add(
        "reading-vocabulary-review",
        "从已读材料回看待复习词汇",
        `原文“${material.title}”有 ${sessions.length} 条唯一的已完成阅读事实，并有 ${group.length} 条状态仍为进行中的词汇记录：${terms}。可选择回看原文、核对词义或自行安排复习；词汇状态不证明记忆程度，没有填写日期的记录不会被推定逾期。这些记录不另加阅读分钟，也不覆盖或替代其他目标。`,
        relevantGoals,
        [materialId, ...sessions, ...group.map((item) => item.entity.id)],
        "回看已读原文并核对待复习词汇",
        materialId,
      );
    }
  }
  const plannedTime = (entity: Entity) =>
    entity.type === "reminder" ? entity.fields.remindAt : entity.fields.due;
  const overdue = visible
    .filter(
      (entity) =>
        entity.module === "learning" &&
        ["checklist-item", "reminder"].includes(entity.type) &&
        entity.kind === "plan" &&
        entity.status === "active" &&
        plannedTime(entity) !== undefined,
    )
    .filter((entity) => {
      try {
        return iso(String(plannedTime(entity)), true) < range.at;
      } catch (error) {
        issues.push({
          entityId: entity.id,
          code: "invalid-advice-due",
          message: String(error),
        });
        return false;
      }
    });
  for (const item of overdue) {
    if (
      pendingTasks.some(
        (task) =>
          task.id !== item.id && targets(task, "evidence").includes(item.id),
      )
    )
      continue;
    const itemGoals = supportedGoals(item);
    const actuals = visible.filter(
      (entity) =>
        entity.kind === "fact" &&
        targets(entity, "actual-of").length === 1 &&
        targets(entity, "actual-of")[0] === item.id,
    );
    add(
      "overdue-plan-review",
      "核对到期待办，决定保留或调整",
      `计划“${item.title}”的用户填写时间 ${String(plannedTime(item))} 已早于查询时间，记录状态仍为进行中；找到 ${actuals.length} 条对应事实。日期和状态不证明实际未完成。可先核对事实，再自行决定保留、改期或停用，不会自动改动原计划或触发通知。`,
      itemGoals,
      [item.id, ...actuals.map((entity) => entity.id)],
      "回看待办记录并决定是否调整",
    );
  }
  return {
    asOf: range.asOf,
    days,
    ruleVersion: ADVICE_RULE_VERSION,
    suggestions,
    issues,
  };
}

function checkTaskEdit(task: AdoptAdviceRequest["task"]) {
  if (task === undefined) return {};
  if (!task || typeof task !== "object" || Array.isArray(task))
    throw Error("Invalid advice task edit");
  for (const key of Object.keys(task)) {
    if (!["title", "body", "due", "focus", "timeZone"].includes(key))
      throw Error("Unsupported advice task edit: " + key);
    const value = task[key as keyof typeof task];
    if (
      typeof value !== "string" ||
      value.length > (key === "body" ? 150000 : key === "title" ? 300 : 20000)
    )
      throw Error("Invalid advice task edit: " + key);
    if (key !== "body" && !value.trim())
      throw Error("Empty advice task edit: " + key);
  }
  return task;
}
function checkDue(value: string, timeZone: string) {
  if (value.length === 10)
    throw Error("Task due requires an offset-aware timestamp");
  const at = iso(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (key: string) =>
    parts.find((piece) => piece.type === key)?.value;
  const local = `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
  const clock = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?/.exec(value)!;
  if (local !== clock[1] + ":" + (clock[2] ?? "00"))
    throw Error("Task due offset does not match its time zone");
}

/** A human adopts a fresh suggestion into a plan. Existing adoption retries never rewrite it. */
export function adoptAdvice(
  store: Store,
  request: AdoptAdviceRequest,
  cap: Capability = HUMAN,
): Entity {
  if (cap.role !== "human")
    throw Error(
      "Permission denied: advice adoption requires an explicit human action",
    );
  store.permit(cap, "write", "learning");
  if (
    !request ||
    typeof request.adviceId !== "string" ||
    !/^[a-f0-9]{64}$/.test(request.adviceId)
  )
    throw Error("Invalid advice ID");
  if (
    request.operationId !== undefined &&
    (typeof request.operationId !== "string" ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(request.operationId))
  )
    throw Error("Invalid advice operation ID");
  const taskEdit = checkTaskEdit(request.task),
    range = window(request.asOf, request.days ?? 7);
  const identity = digest({
    adviceId: request.adviceId,
    asOf: range.asOf,
    days: request.days ?? 7,
    task: taskEdit,
  });
  const entityId = digest(["advice-adoption-v1", request.adviceId]);
  const operationId = request.operationId ?? "adopt-" + request.adviceId;
  const priorRequest = store.db
    .prepare("SELECT entity FROM requests WHERE id=?")
    .get(operationId);
  if (priorRequest && priorRequest.entity !== entityId)
    throw Error("Operation ID reused with different advice");
  const existing = store.get(entityId, cap);
  if (existing) {
    if (
      existing.source.namespace !== "advice-adoption-v1" ||
      existing.source.recordId !== request.adviceId ||
      existing.source.revision !== identity
    )
      throw Error("Advice already adopted with different task content");
    if (existing.deleted)
      throw Error(
        "Adopted advice task is deleted; restore it explicitly instead of creating a duplicate",
      );
    return existing;
  }
  const entities = store.list({}, cap);
  const report = generateAdvice(entities, request.asOf, request.days ?? 7);
  const suggestion = report.suggestions.find(
    (item) => item.id === request.adviceId,
  );
  if (!suggestion)
    throw Error(
      "Advice is stale or unavailable; refresh suggestions before adopting",
    );
  const lookup = new Map(entities.map((entity) => [entity.id, entity]));
  for (const goalId of suggestion.goalIds) {
    const goal = lookup.get(goalId);
    if (!goal || goal.deleted || !activeGoal(goal))
      throw Error("Advice goal is no longer available");
  }
  for (const evidenceId of suggestion.evidenceIds)
    if (!lookup.has(evidenceId))
      throw Error("Advice evidence is no longer available");
  const timeZone = taskEdit.timeZone ?? "UTC";
  new Intl.DateTimeFormat("en", { timeZone });
  if (taskEdit.due) checkDue(taskEdit.due, timeZone);
  const body = [
    taskEdit.body ?? suggestion.proposedTask.body ?? "",
    "",
    "人工采纳本地规则建议；创建计划，不证明已经执行。",
    `建议来源：${suggestion.source.namespace} / ${suggestion.id}`,
    `规则版本：${suggestion.ruleVersion}；规则：${suggestion.ruleId}`,
    `依据解释：${suggestion.explanation}`,
    `目标 ID：${suggestion.goalIds.join(", ") || "未关联目标"}`,
    `依据 ID：${suggestion.evidenceIds.join(", ") || "仅依据目标及记录缺口，没有实际活动证据"}`,
  ].join("\n");
  return store.saveMany(
    [
      {
        expectedVersion: 0,
        operationId,
        entity: {
          id: entityId,
          module: "learning",
          type: "checklist-item",
          title: taskEdit.title ?? suggestion.proposedTask.title,
          kind: "plan",
          status: "active",
          occurredAt: range.asOf,
          timeZone,
          fields: {
            focus: taskEdit.focus ?? suggestion.ruleId,
            ...(taskEdit.due ? { due: taskEdit.due } : {}),
          },
          relations: [
            ...suggestion.goalIds.map((target) => ({
              type: "supports",
              target,
            })),
            ...unique([
              ...suggestion.evidenceIds,
              ...(suggestion.proposedTask.materialId
                ? [suggestion.proposedTask.materialId]
                : []),
            ]).map((target) => ({ type: "evidence", target })),
          ],
          source: {
            namespace: "advice-adoption-v1",
            recordId: suggestion.id,
            revision: identity,
            mode: "manual",
          },
          body,
        },
      },
    ],
    cap,
  )[0];
}
