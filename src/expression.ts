import type { Store } from "./store.js";
import {
  HUMAN,
  type Capability,
  type Entity,
  type EntityInput,
  type Operation,
  type Snapshot,
} from "./types.js";
import { hash } from "./vault.js";
import { permitScopedWrite } from "./permissions.js";

export type ExpressionMode = "文字" | "口头文字记录";
export type ExpressionStructure = {
  claim: string;
  groups: {
    reason: string;
    evidence: { text: string; sourceId?: string; reference?: string }[];
  }[];
};
export type CreateExpressionInput = {
  operationId: string;
  title: string;
  mode: ExpressionMode;
  originalText: string;
  structure?: ExpressionStructure;
  revisedText?: string;
  materialId?: string;
  goalIds?: string[];
  sessionId?: string;
  occurredAt: string;
  timeZone: string;
  status?: "active" | "done";
};
export type ReviseExpressionInput = {
  operationId: string;
  id: string;
  expectedVersion: number;
  expectedNoteHash: string;
  structure?: ExpressionStructure;
  revisedText?: string;
  status?: "active" | "done";
};
export type ExpressionCoverage = {
  hasClaim: boolean;
  reasonGroups: number;
  groupsWithEvidence: number;
  evidenceItems: number;
  referencedEvidenceItems: number;
};
export type ExpressionIssue = {
  code: string;
  message: string;
  groupIndex?: number;
  evidenceIndex?: number;
  sourceId?: string;
};
export type ExpressionFeedback = {
  kind: "inference";
  ruleVersion: "expression-v1";
  practiceId: string;
  originalText: string;
  revisedText: string;
  coverage: ExpressionCoverage;
  issues: ExpressionIssue[];
  sourceChecks: {
    sourceId: string;
    status: "missing" | Entity["kind"];
    groupIndex: number;
    evidenceIndex: number;
  }[];
  revisedDraft: { kind: "inference"; accepted: false; text: string };
  prompts: string[];
  limitations: string[];
};
const modes: ExpressionMode[] = ["文字", "口头文字记录"];
const empty = (): ExpressionStructure => ({ claim: "", groups: [] });
const limits = [
  "这是依据显式结构字段生成的只读整理建议，不是事实核验、官方课程或能力评分。",
  "fact 表示用户记录的材料或活动；不自动证明论点真实，也不等于已实测。inference 和 plan 不能充当已完成的观察。",
  "自由写作与渐进整理可以暂时没有观点或理由组，不要求三句话或固定分组数。",
  "口头练习仅保存用户提供的文字记录，不使用麦克风、自动转录或付费服务。",
];
function text(
  value: unknown,
  label: string,
  max: number,
  nonempty = false,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (nonempty && !value.trim())
  )
    throw Error("Invalid expression " + label);
}
function identity(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(value))
    throw Error("Invalid expression " + label);
}
function status(value: unknown) {
  if (value !== undefined && !["active", "done"].includes(String(value)))
    throw Error("Invalid expression status");
}
export function validateExpressionStructure(
  value: unknown,
): asserts value is ExpressionStructure {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid expression structure");
  const structure = value as ExpressionStructure;
  text(structure.claim, "claim", 20000);
  if (!Array.isArray(structure.groups))
    throw Error("Invalid expression reason groups");
  for (const group of structure.groups) {
    if (!group || typeof group !== "object" || Array.isArray(group))
      throw Error("Invalid expression reason group");
    text(group.reason, "reason", 20000);
    if (!Array.isArray(group.evidence))
      throw Error("Invalid expression evidence list");
    for (const item of group.evidence) {
      if (!item || typeof item !== "object" || Array.isArray(item))
        throw Error("Invalid expression evidence");
      text(item.text, "evidence text", 20000);
      if (item.sourceId !== undefined) identity(item.sourceId, "source ID");
      if (item.reference !== undefined)
        text(item.reference, "reference", 20000);
    }
  }
  if (JSON.stringify(structure).length > 20000)
    throw Error("Expression structure exceeds field limit");
}
function encodeStructure(value: ExpressionStructure) {
  validateExpressionStructure(value);
  // Only protocol fields are stored; source text is never evaluated or fetched.
  return JSON.stringify({
    claim: value.claim,
    groups: value.groups.map((group) => ({
      reason: group.reason,
      evidence: group.evidence.map((item) => ({
        text: item.text,
        ...(item.sourceId !== undefined ? { sourceId: item.sourceId } : {}),
        ...(item.reference !== undefined ? { reference: item.reference } : {}),
      })),
    })),
  });
}
function structureOf(entity: Entity): ExpressionStructure {
  const value = JSON.parse(
    String(entity.fields.structure ?? '{"claim":"","groups":[]}'),
  ) as unknown;
  validateExpressionStructure(value);
  return value;
}
function practice(entity: Entity | null): asserts entity is Entity {
  if (
    !entity ||
    entity.deleted ||
    entity.module !== "learning" ||
    entity.type !== "expression" ||
    entity.kind !== "fact"
  )
    throw Error("Expression requires an existing user practice record");
}
function references(
  store: Store,
  structure: ExpressionStructure,
  cap: Capability,
) {
  const ids = [
    ...new Set(
      structure.groups.flatMap((g) =>
        g.evidence.flatMap((e) => (e.sourceId ? [e.sourceId] : [])),
      ),
    ),
  ];
  return ids.filter((id) => {
    const target = store.get(id, cap);
    return !!target && !target.deleted;
  });
}
function activeGoal(entity: Entity | null): entity is Entity {
  return (
    !!entity &&
    !entity.deleted &&
    entity.kind === "plan" &&
    entity.status === "active" &&
    (entity.type === "goal" ||
      (entity.module === "planning" && entity.type === "direction") ||
      (entity.module === "languages" && entity.type === "language-goal"))
  );
}
function inputFromSnapshot(base: Snapshot): EntityInput {
  return {
    id: base.id,
    module: base.module,
    type: base.type,
    title: base.title,
    kind: base.kind,
    status: base.status,
    occurredAt: base.occurredAt,
    timeZone: base.timeZone,
    fields: structuredClone(base.fields),
    relations: structuredClone(base.relations),
    body: base.body,
    source: structuredClone(base.source),
    deleted: base.deleted,
  };
}
function requestRevision(
  action: "create" | "revise",
  input: CreateExpressionInput | ReviseExpressionInput,
) {
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
  return "request-" + hash(JSON.stringify([action, canonical(input)]));
}
function replayExpression(
  store: Store,
  action: "create" | "revise",
  input: CreateExpressionInput | ReviseExpressionInput,
  cap: Capability,
): Entity | null {
  const row = store.db
    .prepare("SELECT json FROM operations WHERE id=?")
    .get(input.operationId);
  if (!row) return null;
  const operation = JSON.parse(String(row.json)) as Operation;
  const saved = operation.value;
  const revision = input as ReviseExpressionInput;
  if (
    saved.module !== "learning" ||
    saved.type !== "expression" ||
    saved.kind !== "fact" ||
    saved.source.revision !== requestRevision(action, input) ||
    (action === "create"
      ? !!operation.base
      : !operation.base ||
        operation.entityId !== revision.id ||
        operation.base.version !== revision.expectedVersion)
  )
    throw Error("Expression operation ID reused with different content");
  // The historical request is immutable. A receipt replay returns today's row
  // without re-deriving links from goals/sources that may now be done/deleted.
  // Current permissions still apply, including each original relation target.
  if (!store.get(saved.id, cap)) throw Error("Expression practice unavailable");
  const entity = inputFromSnapshot(saved);
  permitScopedWrite(entity, operation.base, cap);
  for (const relation of entity.relations)
    if (!store.get(relation.target, cap))
      throw Error("Expression prior relation target unavailable");
  return store.saveMany(
    [
      {
        operationId: input.operationId,
        expectedVersion: action === "create" ? 0 : revision.expectedVersion,
        ...(action === "revise"
          ? { expectedNoteHash: revision.expectedNoteHash }
          : {}),
        entity,
      },
    ],
    cap,
  )[0];
}

export function createExpression(
  store: Store,
  input: CreateExpressionInput,
  cap: Capability = HUMAN,
): Entity {
  if (!input) throw Error("Invalid expression input");
  identity(input.operationId, "operation ID");
  text(input.title, "title", 300, true);
  text(input.originalText, "original text", 200000, true);
  text(input.occurredAt, "date", 100, true);
  text(input.timeZone, "time zone", 100, true);
  if (!modes.includes(input.mode)) throw Error("Invalid expression mode");
  if (input.revisedText !== undefined)
    text(input.revisedText, "revised text", 20000);
  status(input.status);
  store.permit(cap, "write", "learning");
  store.permit(cap, "read", "learning");
  const replayed = replayExpression(store, "create", input, cap);
  if (replayed) return replayed;
  const structure = input.structure ?? empty();
  const encoded = encodeStructure(structure);
  const relations: EntityInput["relations"] = [];
  if (input.materialId !== undefined) {
    identity(input.materialId, "material ID");
    const material = store.get(input.materialId, cap);
    if (
      !material ||
      material.deleted ||
      material.module !== "learning" ||
      material.type !== "material" ||
      material.kind !== "fact"
    )
      throw Error("Expression requires an existing factual learning material");
    relations.push({ type: "related", target: material.id });
  }
  if (input.sessionId !== undefined) {
    identity(input.sessionId, "session ID");
    const session = store.get(input.sessionId, cap);
    if (
      !session ||
      session.deleted ||
      session.module !== "learning" ||
      session.type !== "session" ||
      session.kind !== "fact"
    )
      throw Error("Expression requires an existing factual learning session");
    relations.push({ type: "evidence", target: session.id });
  }
  if (
    input.goalIds !== undefined &&
    (!Array.isArray(input.goalIds) || input.goalIds.length > 96)
  )
    throw Error("Invalid expression goal selection");
  for (const id of [...new Set(input.goalIds ?? [])].sort()) {
    identity(id, "goal ID");
    const goal = store.get(id, cap);
    if (!activeGoal(goal))
      throw Error("Expression requires active plan goals or directions");
    relations.push({ type: "supports", target: goal.id });
  }
  for (const id of references(store, structure, cap))
    relations.push({ type: "evidence", target: id });
  const unique = relations.filter(
    (relation, index) =>
      relations.findIndex(
        (r) => r.type === relation.type && r.target === relation.target,
      ) === index,
  );
  const id = hash("expression-create-v1:" + input.operationId);
  return store.saveMany(
    [
      {
        operationId: input.operationId,
        expectedVersion: 0,
        entity: {
          id,
          module: "learning",
          type: "expression",
          title: input.title,
          kind: "fact",
          status: input.status ?? "active",
          occurredAt: input.occurredAt,
          timeZone: input.timeZone,
          fields: {
            mode: input.mode,
            structure: encoded,
            revisedText: input.revisedText ?? "",
          },
          relations: unique,
          body: input.originalText,
          source: {
            namespace: "manual-expression-v1",
            recordId: id,
            revision: requestRevision("create", input),
            mode: "manual",
          },
          deleted: false,
        },
      },
    ],
    cap,
  )[0];
}

export function reviseExpression(
  store: Store,
  input: ReviseExpressionInput,
  cap: Capability = HUMAN,
): Entity {
  if (!input) throw Error("Invalid expression revision");
  identity(input.operationId, "operation ID");
  identity(input.id, "practice ID");
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1)
    throw Error("Invalid expression expected version");
  text(input.expectedNoteHash, "expected note hash", 128, true);
  if (
    input.structure === undefined &&
    input.revisedText === undefined &&
    input.status === undefined
  )
    throw Error("Expression revision requires an explicit change");
  if (input.revisedText !== undefined)
    text(input.revisedText, "revised text", 20000);
  status(input.status);
  store.permit(cap, "write", "learning");
  store.permit(cap, "read", "learning");
  const replayed = replayExpression(store, "revise", input, cap);
  if (replayed) return replayed;
  const current = store.get(input.id, cap);
  practice(current);
  const base = store.snapshot(input.id)!;
  const entity = inputFromSnapshot(base);
  if (input.structure !== undefined) {
    entity.fields.structure = encodeStructure(input.structure);
    for (const target of references(store, input.structure, cap))
      if (
        !entity.relations.some(
          (r) => r.type === "evidence" && r.target === target,
        )
      )
        entity.relations.push({ type: "evidence", target });
  }
  if (input.revisedText !== undefined)
    entity.fields.revisedText = input.revisedText;
  if (input.status !== undefined) entity.status = input.status;
  entity.source = {
    ...base.source,
    revision: requestRevision("revise", input),
  };
  // Replayed requests must retain their field/relationship authorization too.
  permitScopedWrite(entity, base, cap);
  return store.saveMany(
    [
      {
        operationId: input.operationId,
        expectedVersion: input.expectedVersion,
        expectedNoteHash: input.expectedNoteHash,
        entity,
      },
    ],
    cap,
  )[0];
}

function coverage(structure: ExpressionStructure): ExpressionCoverage {
  const evidence = structure.groups
    .flatMap((g) => g.evidence)
    .filter((e) => e.text.trim());
  return {
    hasClaim: !!structure.claim.trim(),
    reasonGroups: structure.groups.length,
    groupsWithEvidence: structure.groups.filter(
      (g) => g.reason.trim() && g.evidence.some((e) => e.text.trim()),
    ).length,
    evidenceItems: evidence.length,
    referencedEvidenceItems: evidence.filter(
      (e) => !!e.sourceId || !!e.reference?.trim(),
    ).length,
  };
}

export function expressionFeedback(
  entity: Entity,
  contextEntities: Entity[] = [],
): ExpressionFeedback {
  practice(entity);
  const issues: ExpressionIssue[] = [];
  let structure = empty();
  try {
    structure = structureOf(entity);
  } catch {
    issues.push({
      code: "invalid-structure",
      message: "结构字段无法解析；原稿仍保留，请显式修复结构后再整理。",
    });
  }
  if (!structure.claim.trim())
    issues.push({
      code: "missing-claim",
      message:
        "如果这次想练习结构表达，可以先写希望读者带走的核心观点；自由原稿可继续保留。",
    });
  const reasons = new Map<string, number>();
  const sourceChecks: ExpressionFeedback["sourceChecks"] = [];
  structure.groups.forEach((group, groupIndex) => {
    const normalized = group.reason
      .trim()
      .replace(/\s+/g, " ")
      .toLocaleLowerCase();
    if (!normalized)
      issues.push({
        code: "missing-reason",
        groupIndex,
        message: "这组理由尚未命名；可补一个说明它怎样支持观点的短标题。",
      });
    else if (reasons.has(normalized))
      issues.push({
        code: "duplicate-reason",
        groupIndex,
        message: `这组理由与第 ${reasons.get(normalized)! + 1} 组文字重复；可合并，或说明两组各回答什么问题。`,
      });
    else reasons.set(normalized, groupIndex);
    if (!group.evidence.some((e) => e.text.trim()))
      issues.push({
        code: "missing-evidence",
        groupIndex,
        message:
          "这组尚未填写事实或例子；可以补具体记录，也可以标明目前只是待验证设想。",
      });
    group.evidence.forEach((item, evidenceIndex) => {
      if (!item.text.trim())
        issues.push({
          code: "empty-evidence",
          groupIndex,
          evidenceIndex,
          message: "这条依据还是空白，可填写具体事实、例子或保留为待补项。",
        });
      if (!item.sourceId) return;
      const source = contextEntities.find(
        (e) => e.id === item.sourceId && !e.deleted,
      );
      sourceChecks.push({
        sourceId: item.sourceId,
        status: source?.kind ?? "missing",
        groupIndex,
        evidenceIndex,
      });
      if (!source)
        issues.push({
          code: "missing-source",
          sourceId: item.sourceId,
          groupIndex,
          evidenceIndex,
          message:
            "此来源不在当前可见记录中；可能不存在、已删除或未获读取权限，尚不能核对引用。",
        });
      else if (source.kind === "inference")
        issues.push({
          code: "inference-source",
          sourceId: source.id,
          groupIndex,
          evidenceIndex,
          message: "此来源是推断或建议，应注明其性质，不能写成已实测事实。",
        });
      else if (source.kind === "plan")
        issues.push({
          code: "plan-source",
          sourceId: source.id,
          groupIndex,
          evidenceIndex,
          message: "此来源是计划或目标，不能据此声称活动或结果已经发生。",
        });
    });
  });
  const draft = [
    ...(structure.claim.trim() ? [structure.claim] : []),
    ...structure.groups.map((g) =>
      [
        g.reason,
        ...g.evidence.map(
          (e) => e.text + (e.reference ? `（引用：${e.reference}）` : ""),
        ),
      ]
        .filter((v) => v.trim())
        .join("\n"),
    ),
  ]
    .filter((v) => v.trim())
    .join("\n\n");
  return {
    kind: "inference",
    ruleVersion: "expression-v1",
    practiceId: entity.id,
    originalText: entity.body,
    revisedText: String(entity.fields.revisedText ?? ""),
    coverage: coverage(structure),
    issues,
    sourceChecks,
    revisedDraft: { kind: "inference", accepted: false, text: draft },
    prompts: [
      "你最希望对方理解哪一个核心观点？暂时不确定也可以保留原稿。",
      "哪些理由回答同一个问题，哪些理由应该分开说明？组数由这次内容决定。",
      "每组能补什么可追溯的事实、具体例子或待验证设想？请分别标明性质。",
      "比较原稿与整理稿，检查是否遗漏本意、放大确定性或把建议写成已发生事实。",
    ],
    limitations: [...limits],
  };
}

export function expressionReport(entities: Entity[]) {
  const latest = new Map<string, Entity>();
  for (const entity of entities)
    if (
      !latest.has(entity.id) ||
      latest.get(entity.id)!.version < entity.version
    )
      latest.set(entity.id, entity);
  const visible = [...latest.values()].filter((e) => !e.deleted);
  const practices = visible.filter(
    (e) =>
      e.module === "learning" && e.type === "expression" && e.kind === "fact",
  );
  const sourceIds = new Set<string>(),
    sessionIds = new Set<string>();
  const countModes: Record<ExpressionMode, number> = {
    文字: 0,
    口头文字记录: 0,
  };
  const rows = practices
    .sort(
      (a, b) =>
        a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id),
    )
    .map((entity) => {
      const feedback = expressionFeedback(entity, visible);
      const mode = String(entity.fields.mode);
      if (modes.includes(mode as ExpressionMode))
        countModes[mode as ExpressionMode]++;
      let structure = empty();
      try {
        structure = structureOf(entity);
      } catch {
        /* Feedback carries the parse issue. */
      }
      for (const g of structure.groups)
        for (const item of g.evidence)
          if (item.sourceId) sourceIds.add(item.sourceId);
      const targets = (type: string) =>
        entity.relations
          .filter((r) => r.type === type)
          .map((r) => visible.find((e) => e.id === r.target))
          .filter((e): e is Entity => !!e);
      const sessions = targets("evidence")
        .filter(
          (e) =>
            e.module === "learning" &&
            e.type === "session" &&
            e.kind === "fact",
        )
        .map((e) => e.id);
      sessions.forEach((id) => sessionIds.add(id));
      return {
        id: entity.id,
        title: entity.title,
        mode,
        status: entity.status,
        version: entity.version,
        occurredAt: entity.occurredAt,
        originalText: entity.body,
        revisedText: String(entity.fields.revisedText ?? ""),
        coverage: feedback.coverage,
        issues: feedback.issues,
        goalIds: targets("supports").map((e) => e.id),
        materialIds: targets("related")
          .filter((e) => e.module === "learning" && e.type === "material")
          .map((e) => e.id),
        sessionIds: sessions,
      };
    });
  return {
    kind: "inference" as const,
    practiceCount: practices.length,
    modes: countModes,
    unfinished: practices.filter((e) => e.status !== "done").length,
    recordedVersionChanges: practices.reduce(
      (sum, e) => sum + Math.max(0, e.version - 1),
      0,
    ),
    sourceEvidenceIds: [...sourceIds].sort(),
    timedSessionIds: [...sessionIds].sort(),
    rows,
    limitations: [
      ...limits,
      "结构覆盖反映目前填写的观点、理由与依据，不保证表达能力提升；版本变化也可能来自通用编辑。",
      "表达练习不另外累计分钟；关联学习 session 的时长由学习记录统计，同一 session 不因关联多个目标或练习重复计时。",
    ],
  };
}
