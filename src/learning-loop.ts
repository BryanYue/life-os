import { Store } from "./store.js";
import {
  HUMAN,
  type Capability,
  type Entity,
  type EntityInput,
  type Operation,
  type SaveRequest,
} from "./types.js";
import { hash } from "./vault.js";
import { normalizeLanguage } from "./languages.js";
import { validateLearningTimestamp } from "./learning-tasks.js";
import {
  object,
  text,
  id,
  strings,
  number,
  teacher,
  parseLoopData,
  stable,
  identityKey,
  exposureKey,
  hasLearningLoop,
  type Identity,
  type Candidate,
  type Scale,
  type ConfigData,
  validateConfigChain,
  type SessionData,
  type AssessmentData,
  type AttemptData,
  type TeacherContract,
  type TeacherData,
  type MethodData,
} from "./learning-loop-contract.js";

type Request = {
  operationId: string;
  occurredAt: string;
  timeZone: string;
  title: string;
  language: string;
  goalIds: string[];
  entityId?: string;
  expectedVersion?: number;
  expectedNoteHash?: string;
};
export type ConfigureInput = Request & {
  goalId: string;
  scale: Scale;
  targetScore: number;
  reason: string;
  candidate?: Candidate;
  previousId?: string;
};
export type SessionInput = Request & {
  skill: "听" | "说" | "读" | "写";
  minutes?: number;
  context: string;
  readingSessionId?: string;
};
export type ItemInput = {
  item: Identity;
  skill: "听" | "说" | "读" | "写";
  tag: string;
  answer: string;
  outcome: "correct" | "incorrect" | "unscored";
  errorType?: string;
  goalIds: string[];
  entityId?: string;
  expectedVersion?: number;
  expectedNoteHash?: string;
};
export type AssessmentInput = Request &
  Omit<AssessmentData, "protocol"> & { items: ItemInput[] };
export type AttemptsInput = Request & {
  sessionId: string;
  form: Identity;
  items: ItemInput[];
};
export type MethodInput = Request & {
  method: string;
  reason: string;
  evidenceIds: string[];
  candidate?: Candidate;
};
export type ActionInput = {
  operationId: string;
  entityId: string;
  expectedVersion: number;
  expectedNoteHash: string;
  action: "adopt" | "withdraw";
  occurredAt: string;
  timeZone: string;
};
export type TeacherImportInput = {
  contract: TeacherContract;
  expectedVersion?: number;
  expectedNoteHash?: string;
};
export type TeacherEditInput = {
  operationId: string;
  entityId: string;
  expectedVersion: number;
  expectedNoteHash: string;
  summary: string;
};
const requestKeys = [
  "operationId",
  "occurredAt",
  "timeZone",
  "title",
  "language",
  "goalIds",
  "entityId",
  "expectedVersion",
  "expectedNoteHash",
];
const requiredKeys = [
  "operationId",
  "occurredAt",
  "timeZone",
  "title",
  "language",
  "goalIds",
];
const source = (operationId: string, digest: string) => ({
  namespace: "learning-loop-command",
  recordId: operationId,
  revision: digest,
  mode: "manual" as const,
});
function access(store: Store, cap: Capability, action: "read" | "write") {
  if (cap.role !== "human")
    throw Error("Permission denied: learning loop requires a human capability");
  store.permit(cap, action, "languages");
  if (!hasLearningLoop(store.module("languages")))
    throw Error("Explicit learning loop schema 4 upgrade required");
}
function receipt(
  store: Store,
  name: string,
  input: { operationId: string },
  cap: Capability,
) {
  access(store, cap, "write");
  id(input?.operationId);
  const operationId = hash("learning-loop|" + name + "|" + input.operationId),
    digest = hash(stable(input));
  const row = store.db
    .prepare("SELECT json FROM operations WHERE id=?")
    .get(operationId);
  if (row) {
    const prior = JSON.parse(String(row.json)) as Operation;
    if (prior.value.source.revision !== digest)
      throw Error(
        "Learning operation conflict: operationId reused with different content",
      );
    const current = store.get(prior.entityId, cap);
    if (!current)
      throw Error(
        "Learning operation target unavailable; preserve input and reload",
      );
    return { operationId, digest, current };
  }
  return { operationId, digest };
}
function common(store: Store, input: Request, cap: Capability) {
  text(input.title, "title", 300);
  const language = normalizeLanguage(input.language);
  if (!language) throw Error("Invalid learning language");
  validateLearningTimestamp(input.occurredAt, input.timeZone);
  strings(input.goalIds, "goals", true);
  const old = input.entityId ? store.get(input.entityId, cap) : null;
  for (const goalId of input.goalIds) {
    if (
      !old?.relations.some((r) => r.type === "supports" && r.target === goalId)
    )
      goal(store, goalId, cap);
  }
  return language;
}
function existing(
  store: Store,
  entityId: string,
  type: string,
  cap: Capability,
  allowDeleted = false,
) {
  id(entityId);
  const e = store.get(entityId, cap);
  if (
    !e ||
    e.module !== "languages" ||
    e.type !== type ||
    (!allowDeleted && e.deleted)
  )
    throw Error("Unknown or deleted learning " + type);
  return e;
}
function goal(store: Store, goalId: string, cap: Capability) {
  id(goalId);
  const e = store.get(goalId, cap);
  if (
    !e ||
    e.deleted ||
    e.kind !== "plan" ||
    e.status !== "active" ||
    !["goal", "language-goal", "direction"].includes(e.type)
  )
    throw Error("Learning requires an existing active goal");
  store.permit(cap, "read", e.module);
  store.module(e.module);
  return e;
}
function version(
  e: Entity,
  expectedVersion: unknown,
  expectedNoteHash: unknown,
) {
  if (expectedVersion !== e.version || expectedNoteHash !== e.noteHash)
    throw Error(
      "Version or Markdown conflict: reload, preserve edits and retry with the current version/hash",
    );
}
const relations = (ids: string[]) =>
  ids.map((target) => ({ type: "supports", target }));
function inputFrom(e: Entity): EntityInput {
  return {
    id: e.id,
    module: e.module,
    type: e.type,
    title: e.title,
    kind: e.kind,
    status: e.status,
    occurredAt: e.occurredAt,
    timeZone: e.timeZone,
    fields: { ...e.fields },
    relations: [...e.relations],
    body: e.body,
    source: { ...e.source },
    deleted: e.deleted,
  };
}
function requestFor(
  store: Store,
  type: string,
  input: Request,
  fields: Entity["fields"],
  links: Entity["relations"],
  kind: Entity["kind"],
  status: Entity["status"],
  command: ReturnType<typeof receipt>,
  cap: Capability,
  suffix = "",
): SaveRequest {
  const old = input.entityId
    ? existing(store, input.entityId, type, cap)
    : null;
  if (old) version(old, input.expectedVersion, input.expectedNoteHash);
  else if (input.expectedVersion !== undefined && input.expectedVersion !== 0)
    throw Error("New learning record expects version 0");
  return {
    expectedVersion: old?.version ?? 0,
    expectedNoteHash: old?.noteHash,
    operationId: suffix
      ? hash(command.operationId + suffix)
      : command.operationId,
    entity: {
      ...(old ? inputFrom(old) : {}),
      id:
        old?.id ?? hash("learning-loop-entity|" + command.operationId + suffix),
      module: "languages",
      type,
      title: input.title,
      kind,
      status,
      occurredAt: input.occurredAt,
      timeZone: input.timeZone,
      fields: { ...old?.fields, ...fields },
      relations: [
        ...(old?.relations.filter(
          (r) => !["supports", "evidence"].includes(r.type),
        ) ?? []),
        ...links,
      ],
      body: old?.body ?? "",
      source: source(input.operationId, command.digest),
    },
  };
}
export function configureLearning(
  store: Store,
  input: ConfigureInput,
  cap = HUMAN,
) {
  object(
    input,
    [
      ...requestKeys,
      "goalId",
      "scale",
      "targetScore",
      "reason",
      "candidate",
      "previousId",
    ],
    [...requiredKeys, "goalId", "scale", "targetScore", "reason"],
  );
  const command = receipt(store, "configure", input, cap);
  if (command.current) return command.current;
  const language = common(store, input, cap);
  if (input.entityId)
    throw Error(
      "Configurations are appended; choose previousId to preserve target history",
    );
  const selectedGoal = goal(store, input.goalId, cap);
  if (
    selectedGoal.type === "language-goal" &&
    normalizeLanguage(selectedGoal.fields.language) !== language
  )
    throw Error("Goal language mismatch");
  const history = store
    .list({ module: "languages", includeDeleted: true }, cap)
    .filter((e) => e.type === "learning-config")
    .map((e) => ({
      e,
      data: parseLoopData(e.type, e.fields.data) as ConfigData,
    }))
    .filter(
      (row) =>
        row.data.goalId === input.goalId &&
        normalizeLanguage(row.e.fields.language) === language,
    )
    .sort((a, b) => b.data.revision - a.data.revision);
  const previous = history[0];
  if (input.previousId !== previous?.e.id)
    throw Error(
      "Config history conflict: reload and use the latest previousId",
    );
  const data: ConfigData = {
    protocol: 1,
    goalId: input.goalId,
    scale: input.scale,
    targetScore: input.targetScore,
    reason: input.reason,
    revision: (previous?.data.revision ?? 0) + 1,
    ...(previous ? { previousId: previous.e.id } : {}),
    ...(input.candidate ? { candidate: input.candidate } : {}),
  };
  parseLoopData("learning-config", stable(data));
  return store.save(
    requestFor(
      store,
      "learning-config",
      input,
      { language, data: stable(data) },
      relations([...new Set([...input.goalIds, input.goalId])]),
      "plan",
      "active",
      command,
      cap,
    ),
    cap,
  );
}
export function recordLearningSession(
  store: Store,
  input: SessionInput,
  cap = HUMAN,
) {
  object(
    input,
    [...requestKeys, "skill", "minutes", "context", "readingSessionId"],
    [...requiredKeys, "skill", "context"],
  );
  const command = receipt(store, "session", input, cap);
  if (command.current) return command.current;
  const language = common(store, input, cap);
  text(input.context, "session context");
  if (!["听", "说", "读", "写"].includes(input.skill))
    throw Error("Invalid learning skill");
  const data: SessionData = {
    protocol: 1,
    ...(input.readingSessionId
      ? { readingSessionId: input.readingSessionId }
      : {}),
  };
  const links = relations(input.goalIds);
  let fields: Entity["fields"] = {
    language,
    skill: input.skill,
    context: input.context,
    learningData: stable(data),
  };
  if (input.readingSessionId) {
    const old = input.entityId ? store.get(input.entityId, cap) : null;
    const retained =
      old?.type === "practice" &&
      old.fields.learningData !== undefined &&
      (parseLoopData("practice", old.fields.learningData) as SessionData)
        .readingSessionId === input.readingSessionId;
    const reading = store.get(input.readingSessionId, cap);
    if (
      !reading ||
      (reading.deleted && !retained) ||
      reading.module !== "learning" ||
      reading.type !== "session" ||
      reading.kind !== "fact" ||
      reading.status !== "done" ||
      normalizeLanguage(reading.fields.language) !== language
    )
      throw Error(
        "Existing completed reading session in the same language required",
      );
    store.permit(cap, "read", "learning");
    if (!retained) store.module("learning");
    if (input.minutes !== undefined)
      throw Error("Reading session owns the duration; omit minutes");
    links.push({ type: "evidence", target: reading.id });
  } else {
    number(input.minutes, 0.01, 1440);
    fields = { ...fields, minutes: input.minutes! };
  }
  const req = requestFor(
    store,
    "practice",
    input,
    fields,
    links,
    "fact",
    "done",
    command,
    cap,
  );
  if (input.readingSessionId) delete req.entity.fields.minutes;
  return store.save(req, cap);
}
function itemsRequests(
  store: Store,
  input: Request,
  sessionId: string,
  form: Identity,
  items: ItemInput[],
  assessmentId: string | undefined,
  command: ReturnType<typeof receipt>,
  cap: Capability,
) {
  if (!Array.isArray(items) || items.length > 100 || !items.length)
    throw Error("One to 100 synthetic/authorized item attempts required");
  const seen = new Set<string>();
  return items.map((item, index) => {
    object(
      item,
      [
        "item",
        "skill",
        "tag",
        "answer",
        "outcome",
        "errorType",
        "goalIds",
        "entityId",
        "expectedVersion",
        "expectedNoteHash",
      ],
      ["item", "skill", "tag", "answer", "outcome", "goalIds"],
    );
    const key = identityKey(item.item),
      exposure = exposureKey(item.item);
    if (seen.has(exposure))
      throw Error("Duplicate item identity inside one session submission");
    seen.add(exposure);
    strings(item.goalIds, "item goals", true);
    const old = item.entityId
      ? existing(store, item.entityId, "attempt", cap)
      : null;
    for (const target of item.goalIds)
      if (
        !old?.relations.some(
          (r) => r.type === "supports" && r.target === target,
        )
      )
        goal(store, target, cap);
    const data: AttemptData = {
      protocol: 1,
      sessionId,
      ...(assessmentId ? { assessmentId } : {}),
      item: item.item,
      form,
      skill: item.skill,
      tag: item.tag,
      answer: item.answer,
      outcome: item.outcome,
      ...(item.errorType ? { errorType: item.errorType } : {}),
    };
    parseLoopData("attempt", stable(data));
    if (old) {
      const prior = parseLoopData("attempt", old.fields.data) as AttemptData;
      if (
        identityKey(prior.item) !== key ||
        identityKey(prior.form) !== identityKey(form) ||
        prior.sessionId !== sessionId ||
        prior.assessmentId !== assessmentId
      )
        throw Error(
          "Attempt identity/session/form immutable; correct answer/outcome or delete the mistaken record (exposure history remains)",
        );
    }
    return requestFor(
      store,
      "attempt",
      {
        ...input,
        ...item,
        title: `${input.title} · ${item.item.id}`,
        entityId: item.entityId,
        expectedVersion: item.expectedVersion,
        expectedNoteHash: item.expectedNoteHash,
      },
      { language: normalizeLanguage(input.language)!, data: stable(data) },
      [
        ...relations(item.goalIds),
        { type: "evidence", target: sessionId },
        ...(assessmentId ? [{ type: "evidence", target: assessmentId }] : []),
      ],
      "fact",
      "done",
      command,
      cap,
      "|item|" + index,
    );
  });
}
export function recordAssessment(
  store: Store,
  input: AssessmentInput,
  cap = HUMAN,
) {
  const keys = [
    "phase",
    "category",
    "sessionId",
    "evaluation",
    "scale",
    "form",
    "difficulty",
    "conditions",
    "score",
    "scoreReference",
    "items",
  ];
  object(
    input,
    [...requestKeys, ...keys],
    [
      ...requiredKeys,
      "phase",
      "category",
      "evaluation",
      "scale",
      "form",
      "difficulty",
      "conditions",
      "items",
    ],
  );
  const command = receipt(store, "assessment", input, cap);
  if (command.current)
    return {
      assessment: command.current,
      attempts: store
        .list({ module: "languages", includeDeleted: true }, cap)
        .filter(
          (e) =>
            e.type === "attempt" &&
            (parseLoopData(e.type, e.fields.data) as AttemptData)
              .assessmentId === command.current!.id,
        ),
    };
  const language = common(store, input, cap);
  const data: AssessmentData = {
    protocol: 1,
    phase: input.phase,
    category: input.category,
    evaluation: input.evaluation,
    scale: input.scale,
    form: input.form,
    difficulty: input.difficulty,
    conditions: input.conditions,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.score !== undefined
      ? { score: input.score, scoreReference: input.scoreReference }
      : {}),
  };
  parseLoopData("assessment", stable(data));
  if (input.sessionId) {
    const session = existing(store, input.sessionId, "practice", cap);
    if (
      normalizeLanguage(session.fields.language) !== language ||
      session.kind !== "fact" ||
      session.status !== "done"
    )
      throw Error("Assessment needs a completed session in the same language");
  }
  if (input.category === "official" && input.items.length)
    throw Error(
      "Official scores are separately reported; do not import official test items",
    );
  if (input.category === "official" && input.score === undefined)
    throw Error(
      "Official record requires a reported score and source, without conversion",
    );
  const req = requestFor(
    store,
    "assessment",
    input,
    { language, data: stable(data) },
    [
      ...relations(input.goalIds),
      ...(input.sessionId
        ? [{ type: "evidence", target: input.sessionId }]
        : []),
    ],
    "fact",
    "done",
    command,
    cap,
  );
  const attempts =
    input.category === "official"
      ? []
      : itemsRequests(
          store,
          input,
          input.sessionId!,
          input.form,
          input.items,
          req.entity.id!,
          command,
          cap,
        );
  const saved = store.saveMany([req, ...attempts], cap);
  return { assessment: saved[0], attempts: saved.slice(1) };
}
export function recordLearningAttempts(
  store: Store,
  input: AttemptsInput,
  cap = HUMAN,
) {
  object(
    input,
    [...requestKeys, "sessionId", "form", "items"],
    [...requiredKeys, "sessionId", "form", "items"],
  );
  const command = receipt(store, "attempts", input, cap);
  if (command.current)
    return store
      .list({ module: "languages", includeDeleted: true }, cap)
      .filter(
        (e) => e.type === "attempt" && e.source.recordId === input.operationId,
      );
  common(store, input, cap);
  const session = existing(store, input.sessionId, "practice", cap);
  if (
    normalizeLanguage(session.fields.language) !==
    normalizeLanguage(input.language)
  )
    throw Error("Session language mismatch");
  const reqs = itemsRequests(
    store,
    input,
    input.sessionId,
    input.form,
    input.items,
    undefined,
    command,
    cap,
  );
  // Anchor the command receipt to the first real attempt; no private database/table.
  reqs[0].operationId = command.operationId;
  return store.saveMany(reqs, cap);
}
export function proposeLearningMethod(
  store: Store,
  input: MethodInput,
  cap = HUMAN,
) {
  object(
    input,
    [...requestKeys, "method", "reason", "evidenceIds", "candidate"],
    [...requiredKeys, "method", "reason", "evidenceIds"],
  );
  const command = receipt(store, "method", input, cap);
  if (command.current) return command.current;
  const language = common(store, input, cap);
  const data: MethodData = {
    protocol: 1,
    method: input.method,
    reason: input.reason,
    evidenceIds: input.evidenceIds,
    ...(input.candidate ? { candidate: input.candidate } : {}),
  };
  parseLoopData("method-adjustment", stable(data));
  for (const evidenceId of input.evidenceIds) {
    const e = store.get(evidenceId, cap);
    if (!e || e.deleted || e.kind === "plan")
      throw Error("Method needs actual existing evidence");
    store.permit(cap, "read", e.module);
  }
  return store.save(
    requestFor(
      store,
      "method-adjustment",
      input,
      { language, data: stable(data) },
      [
        ...relations(input.goalIds),
        ...input.evidenceIds.map((target) => ({ type: "evidence", target })),
      ],
      "inference",
      "draft",
      command,
      cap,
    ),
    cap,
  );
}
export function actOnLearningMethod(
  store: Store,
  input: ActionInput,
  cap = HUMAN,
) {
  object(input, [
    "operationId",
    "entityId",
    "expectedVersion",
    "expectedNoteHash",
    "action",
    "occurredAt",
    "timeZone",
  ]);
  const command = receipt(store, "method-action", input, cap);
  if (command.current) return command.current;
  const old = existing(store, input.entityId, "method-adjustment", cap);
  version(old, input.expectedVersion, input.expectedNoteHash);
  validateLearningTimestamp(input.occurredAt, input.timeZone);
  const data = parseLoopData(old.type, old.fields.data) as MethodData;
  if (input.action === "withdraw") {
    if (old.kind !== "plan" || old.status !== "active")
      throw Error("Withdraw requires an active adopted method");
    return store.save(
      {
        operationId: command.operationId,
        expectedVersion: old.version,
        expectedNoteHash: old.noteHash,
        entity: {
          ...inputFrom(old),
          status: "failed",
          source: source(input.operationId, command.digest),
        },
      },
      cap,
    );
  }
  if (
    input.action !== "adopt" ||
    old.kind !== "inference" ||
    old.status !== "draft"
  )
    throw Error("Adopt requires an explicit method proposal");
  const plans = store
    .list({ module: "languages" }, cap)
    .filter((e) => e.type === old.type && e.kind === "plan");
  if (
    plans.some(
      (e) =>
        (parseLoopData(e.type, e.fields.data) as MethodData).proposalId ===
        old.id,
    )
  )
    throw Error(
      "Method proposal already adopted; withdraw the existing plan if needed",
    );
  const previous = plans
    .filter(
      (e) =>
        e.status === "active" &&
        normalizeLanguage(e.fields.language) ===
          normalizeLanguage(old.fields.language),
    )
    .at(-1);
  return store.save(
    {
      operationId: command.operationId,
      expectedVersion: 0,
      entity: {
        ...inputFrom(old),
        id: hash("learning-loop-adoption|" + command.operationId),
        title: "已采纳 · " + old.title,
        kind: "plan",
        status: "active",
        occurredAt: input.occurredAt,
        timeZone: input.timeZone,
        fields: {
          ...old.fields,
          data: stable({
            ...data,
            proposalId: old.id,
            ...(previous ? { previousId: previous.id } : {}),
          }),
        },
        relations: [...old.relations, { type: "actual-of", target: old.id }],
        source: source(input.operationId, command.digest),
      },
    },
    cap,
  );
}
export function importTeacherSummary(
  store: Store,
  input: TeacherImportInput,
  cap = HUMAN,
) {
  access(store, cap, "write");
  object(
    input,
    ["contract", "expectedVersion", "expectedNoteHash"],
    ["contract"],
  );
  teacher(input.contract);
  const contract = input.contract;
  validateLearningTimestamp(contract.occurredAt, contract.timeZone);
  const namespace = "learning-teacher:" + contract.source.namespace,
    sourceId = contract.source.id,
    revision = String(contract.source.revision);
  const sourceReceipt = store.db
    .prepare(
      "SELECT entity FROM source_receipts WHERE namespace=? AND source_id=? AND revision=?",
    )
    .get(namespace, sourceId, revision);
  const head = store.db
    .prepare(
      "SELECT entity,revision FROM imports WHERE namespace=? AND source_id=?",
    )
    .get(namespace, sourceId);
  const old = head ? store.get(String(head.entity), cap) : null;
  // A known revision is still verified by Store against its digest, but is never reapplied.
  if (!sourceReceipt && old) {
    if (old.deleted)
      throw Error(
        "Teacher summary deleted: restore it explicitly before a new revision",
      );
    if (contract.source.revision <= Number(head!.revision))
      throw Error(
        "Teacher revision conflict: unrecognized older revision; preserve original file",
      );
    version(old, input.expectedVersion, input.expectedNoteHash);
  }
  if (!sourceReceipt) {
    for (const goalId of contract.goalIds) goal(store, goalId, cap);
    for (const sessionId of contract.sessionIds) {
      const session = existing(store, sessionId, "practice", cap);
      if (
        normalizeLanguage(session.fields.language) !==
        normalizeLanguage(contract.language)
      )
        throw Error("Teacher session language mismatch");
    }
  }
  const data: TeacherData = {
    protocol: 1,
    contract,
    summary: contract.summary,
  };
  const encoded = stable(data);
  parseLoopData("teacher-summary", encoded);
  const originalOperation = sourceReceipt
    ? store.db
        .prepare(
          "SELECT json FROM operations WHERE json_extract(json,'$.value.source.namespace')=? AND json_extract(json,'$.value.source.recordId')=? AND json_extract(json,'$.value.source.revision')=? ORDER BY seq LIMIT 1",
        )
        .get(namespace, sourceId, revision)
    : undefined;
  const preserved = originalOperation
    ? (JSON.parse(String(originalOperation.json)) as Operation).value
    : old;
  return store.importSource(
    {
      module: "languages",
      type: "teacher-summary",
      title: `教师摘要 · ${sourceId}`,
      kind: "inference",
      status: "draft",
      occurredAt: contract.occurredAt,
      timeZone: contract.timeZone,
      fields: {
        ...preserved?.fields,
        language: normalizeLanguage(contract.language)!,
        data: encoded,
      },
      relations: [
        ...(preserved?.relations.filter(
          (r) => !["supports", "evidence"].includes(r.type),
        ) ?? []),
        ...relations(contract.goalIds),
        ...contract.sessionIds.map((target) => ({ type: "evidence", target })),
      ],
      body: contract.originalText,
      source: { namespace, recordId: sourceId, revision, mode: "import" },
    },
    cap,
    input,
  );
}
export function reviseTeacherSummary(
  store: Store,
  input: TeacherEditInput,
  cap = HUMAN,
) {
  object(input, [
    "operationId",
    "entityId",
    "expectedVersion",
    "expectedNoteHash",
    "summary",
  ]);
  const command = receipt(store, "teacher-edit", input, cap);
  if (command.current) return command.current;
  const old = existing(store, input.entityId, "teacher-summary", cap);
  version(old, input.expectedVersion, input.expectedNoteHash);
  text(input.summary, "teacher summary", 5000);
  const data = parseLoopData(old.type, old.fields.data) as TeacherData;
  return store.save(
    {
      expectedVersion: old.version,
      expectedNoteHash: old.noteHash,
      operationId: command.operationId,
      entity: {
        ...inputFrom(old),
        fields: {
          ...old.fields,
          data: stable({ ...data, summary: input.summary }),
        },
        source: source(input.operationId, command.digest),
      },
    },
    cap,
  );
}

type Issue = { entityId: string; message: string };
export type LearningLoopReport = {
  kind: "inference";
  ruleVersion: "learning-loop-v1";
  uniqueTotalMinutes: number;
  timeEvidence: {
    ownerId: string;
    minutes: number;
    sessionIds: string[];
    goalIds: string[];
  }[];
  configurations: { entity: Entity; data: ConfigData; current: boolean }[];
  sessions: {
    entity: Entity;
    data: SessionData | null;
    counted: boolean;
    ownerId: string;
    minutes: number;
  }[];
  assessments: {
    entity: Entity;
    data: AssessmentData;
    attempts: string[];
    firstCount: number;
    repeatedCount: number;
    scoredCount: number;
    correctCount: number;
    sampleStatus: "insufficient" | "descriptive-only";
  }[];
  attempts: {
    entity: Entity;
    data: AttemptData;
    exposure: "first" | "repeat";
    firstEvidenceId: string;
  }[];
  weaknesses: {
    language: string;
    skill: string;
    tag: string;
    samples: number;
    incorrect: number;
    repeated: number;
    evidenceIds: string[];
    errorTypes: string[];
    sampleStatus: "insufficient" | "descriptive-only";
  }[];
  comparisons: {
    baselineId: string;
    retestId: string;
    comparable: boolean;
    reasons: string[];
    scoreDelta?: number;
    sampleStatus: "insufficient" | "descriptive-only";
    conclusion: string;
  }[];
  teacherSummaries: {
    entity: Entity;
    data: TeacherData;
    revisions: {
      version: number;
      sourceRevision: number;
      originalText: string;
      summary: string;
    }[];
  }[];
  methods: { entity: Entity; data: MethodData }[];
  issues: Issue[];
  policy: string;
};
export function learningLoopReport(
  store: Store,
  cap = HUMAN,
): LearningLoopReport {
  access(store, cap, "read");
  const entities = store.list({ includeDeleted: true }, cap),
    byId = new Map(entities.map((e) => [e.id, e]));
  const issues: Issue[] = [];
  const parsed = new Map<string, ReturnType<typeof parseLoopData>>();
  for (const e of entities.filter(
    (e) =>
      e.module === "languages" &&
      ([
        "learning-config",
        "assessment",
        "attempt",
        "teacher-summary",
        "method-adjustment",
      ].includes(e.type) ||
        (e.type === "practice" && e.fields.learningData !== undefined)),
  )) {
    try {
      parsed.set(
        e.id,
        parseLoopData(
          e.type,
          e.fields[e.type === "practice" ? "learningData" : "data"],
        ),
      );
    } catch (error) {
      issues.push({
        entityId: e.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const history: Operation[] = [];
  let exposureHistoryIncomplete = false;
  for (const row of store.db
    .prepare("SELECT json FROM operations ORDER BY seq")
    .all()) {
    try {
      const op = JSON.parse(String(row.json)) as Operation;
      if (op.value.module === "languages") history.push(op);
    } catch {
      exposureHistoryIncomplete = true;
      issues.push({
        entityId: "history",
        message:
          "Unreadable operation history preserved; exposure/comparison may be incomplete",
      });
    }
  }
  const exposures = new Map<string, Map<string, number>>();
  for (const op of history.filter((op) => op.value.type === "attempt")) {
    try {
      for (const snapshot of [op.base, op.value]) {
        if (!snapshot || snapshot.type !== "attempt") continue;
        const d = parseLoopData("attempt", snapshot.fields.data) as AttemptData;
        validateLearningTimestamp(snapshot.occurredAt, snapshot.timeZone);
        const key = exposureKey(d.item),
          time = Date.parse(snapshot.occurredAt),
          known = exposures.get(key) ?? new Map<string, number>();
        known.set(
          op.entityId,
          Math.min(known.get(op.entityId) ?? Infinity, time),
        );
        exposures.set(key, known);
      }
    } catch {
      exposureHistoryIncomplete = true;
      issues.push({
        entityId: op.entityId,
        message:
          "Unreadable historical attempt; cannot claim unseen items from incomplete history",
      });
    }
  }
  const firstSeen = new Map<string, string>(),
    ambiguous = new Set<string>();
  for (const [key, records] of exposures) {
    const rows = [...records.entries()].sort((a, b) => a[1] - b[1]);
    firstSeen.set(key, rows[0][0]);
    if (rows.length > 1 && rows[0][1] === rows[1][1]) {
      ambiguous.add(key);
      issues.push({
        entityId: rows[0][0],
        message:
          "作答历史时间相同，首答先后不明；保守视为重复，无法确认新题比较。",
      });
    }
  }
  const active = (type: string) =>
    entities.filter(
      (e) =>
        !e.deleted &&
        e.module === "languages" &&
        e.type === type &&
        parsed.has(e.id),
    );
  for (const e of entities.filter((e) => !e.deleted && parsed.has(e.id)))
    for (const relation of e.relations) {
      const target = byId.get(relation.target);
      if (!target || target.deleted)
        issues.push({
          entityId: e.id,
          message: `关联记录 ${relation.target} 当前不可用；保留原始关联，可在回收站恢复。`,
        });
    }
  const attempts = active("attempt").map((entity) => {
    const data = parsed.get(entity.id) as AttemptData;
    const firstEvidenceId = firstSeen.get(exposureKey(data.item));
    if (!firstEvidenceId) {
      exposureHistoryIncomplete = true;
      issues.push({
        entityId: entity.id,
        message: "Attempt exposure history missing; treated as repeat",
      });
    }
    return {
      entity,
      data,
      exposure:
        firstEvidenceId === entity.id && !ambiguous.has(exposureKey(data.item))
          ? ("first" as const)
          : ("repeat" as const),
      firstEvidenceId: firstEvidenceId ?? "unknown",
    };
  });
  const timeOwners = new Map<
    string,
    {
      ownerId: string;
      minutes: number;
      sessionIds: string[];
      goalIds: string[];
    }
  >();
  const sessions = entities
    .filter(
      (e) =>
        !e.deleted &&
        e.module === "languages" &&
        e.type === "practice" &&
        e.kind === "fact" &&
        e.status === "done",
    )
    .map((entity) => {
      const data = parsed.get(entity.id) as SessionData | undefined,
        ownerId = data?.readingSessionId ?? entity.id,
        owner = byId.get(ownerId);
      const valid =
        (entity.fields.learningData === undefined || !!data) &&
        !!owner &&
        !owner.deleted &&
        owner.kind === "fact" &&
        owner.status === "done" &&
        typeof owner.fields.minutes === "number" &&
        owner.fields.minutes > 0 &&
        owner.fields.minutes <= 1440;
      const minutes = valid ? Number(owner.fields.minutes) : 0;
      if (!valid)
        issues.push({
          entityId: entity.id,
          message:
            "Session duration owner is missing/deleted/invalid; not counted",
        });
      const goalIds = entity.relations
        .filter((r) => r.type === "supports")
        .map((r) => r.target);
      if (valid) {
        const known = timeOwners.get(ownerId);
        if (known) {
          known.sessionIds.push(entity.id);
          known.goalIds = [...new Set([...known.goalIds, ...goalIds])];
        } else
          timeOwners.set(ownerId, {
            ownerId,
            minutes,
            sessionIds: [entity.id],
            goalIds,
          });
      }
      return { entity, data: data ?? null, counted: valid, ownerId, minutes };
    });
  // Include completed reading sessions in the union, even when no loop session references them.
  for (const e of entities.filter(
    (e) =>
      !e.deleted &&
      e.module === "learning" &&
      e.type === "session" &&
      e.kind === "fact" &&
      e.status === "done" &&
      typeof e.fields.minutes === "number" &&
      e.fields.minutes > 0 &&
      e.fields.minutes <= 1440,
  )) {
    const links = e.relations
        .filter((r) => r.type === "supports")
        .map((r) => r.target),
      known = timeOwners.get(e.id);
    if (known) known.goalIds = [...new Set([...known.goalIds, ...links])];
    else
      timeOwners.set(e.id, {
        ownerId: e.id,
        minutes: Number(e.fields.minutes),
        sessionIds: [],
        goalIds: links,
      });
  }
  const usableAttempts = attempts.filter((row) => {
    const session = byId.get(row.data.sessionId),
      assessment = row.data.assessmentId
        ? byId.get(row.data.assessmentId)
        : null;
    if (
      !session ||
      session.deleted ||
      (row.data.assessmentId && (!assessment || assessment.deleted))
    ) {
      issues.push({
        entityId: row.entity.id,
        message:
          "Linked session/assessment deleted; attempt retained but excluded from sample statistics",
      });
      return false;
    }
    return true;
  });
  const assessments = active("assessment").map((entity) => {
    const data = parsed.get(entity.id) as AssessmentData,
      samples = usableAttempts.filter(
        (row) => row.data.assessmentId === entity.id,
      ),
      scored = samples.filter((row) => row.data.outcome !== "unscored"),
      firstCount = samples.filter((row) => row.exposure === "first").length;
    return {
      entity,
      data,
      attempts: samples.map((row) => row.entity.id),
      firstCount,
      repeatedCount: samples.length - firstCount,
      scoredCount: scored.length,
      correctCount: scored.filter((row) => row.data.outcome === "correct")
        .length,
      sampleStatus:
        scored.filter((row) => row.exposure === "first").length < 5
          ? ("insufficient" as const)
          : ("descriptive-only" as const),
    };
  });
  const weaknesses: LearningLoopReport["weaknesses"] = [];
  for (const row of usableAttempts) {
    const language = normalizeLanguage(row.entity.fields.language)!,
      key = stable([language, row.data.skill, row.data.tag]);
    let group = weaknesses.find(
      (g) => stable([g.language, g.skill, g.tag]) === key,
    );
    if (!group) {
      group = {
        language,
        skill: row.data.skill,
        tag: row.data.tag,
        samples: 0,
        incorrect: 0,
        repeated: 0,
        evidenceIds: [],
        errorTypes: [],
        sampleStatus: "insufficient",
      };
      weaknesses.push(group);
    }
    group.evidenceIds.push(row.entity.id);
    if (row.data.outcome !== "unscored") group.samples++;
    if (row.data.outcome === "incorrect") {
      group.incorrect++;
      group.errorTypes = [
        ...new Set([...group.errorTypes, row.data.errorType!]),
      ];
    }
    if (row.exposure === "repeat") group.repeated++;
    group.sampleStatus =
      group.samples < 5 ? "insufficient" : "descriptive-only";
  }
  for (const group of weaknesses) {
    group.samples = new Set(
      usableAttempts
        .filter(
          (row) =>
            normalizeLanguage(row.entity.fields.language) === group.language &&
            row.data.skill === group.skill &&
            row.data.tag === group.tag &&
            row.data.outcome !== "unscored",
        )
        .map((row) => exposureKey(row.data.item)),
    ).size;
    group.sampleStatus =
      group.samples < 5 ? "insufficient" : "descriptive-only";
  }
  const comparisons: LearningLoopReport["comparisons"] = [];
  for (const baseline of assessments.filter(
    (row) => row.data.phase === "baseline",
  ))
    for (const retest of assessments.filter(
      (row) =>
        row.data.phase === "retest" &&
        normalizeLanguage(row.entity.fields.language) ===
          normalizeLanguage(baseline.entity.fields.language),
    )) {
      const a = baseline.data,
        b = retest.data,
        reasons: string[] = [];
      if (a.category !== b.category)
        reasons.push("官方成绩、模拟与练习类别不同");
      if (a.category === "official" || b.category === "official")
        reasons.push(
          "官方成绩仅保存独立来源；没有题目证据，无法验证新题可比性",
        );
      if (identityKey(a.evaluation) !== identityKey(b.evaluation))
        reasons.push("评测协议/版本/来源不同");
      if (stable(a.scale) !== stable(b.scale))
        reasons.push("量尺或分数范围不同");
      if (a.form.source !== b.form.source) reasons.push("题卷来源不同");
      if (a.difficulty !== b.difficulty) reasons.push("难度不同");
      if (a.conditions !== b.conditions) reasons.push("测试条件不同");
      if (identityKey(a.form) === identityKey(b.form))
        reasons.push("复测题卷身份/版本与基线相同");
      if (
        Date.parse(retest.entity.occurredAt) <=
        Date.parse(baseline.entity.occurredAt)
      )
        reasons.push("复测时间没有晚于基线");
      const retestSamples = usableAttempts.filter(
        (row) => row.data.assessmentId === retest.entity.id,
      );
      if (
        !retestSamples.length ||
        retestSamples.some((row) => row.exposure !== "first")
      )
        reasons.push("复测必须全部为历史未作答的新题");
      if (
        baseline.scoredCount !== retest.scoredCount ||
        baseline.scoredCount === 0
      )
        reasons.push("有效评分题目数量不同或没有评分题目");
      if (baseline.repeatedCount)
        reasons.push("基线包含历史重复作答，不能作为首次新题基线");
      const composition = (assessmentId: string) =>
        stable(
          usableAttempts
            .filter(
              (row) =>
                row.data.assessmentId === assessmentId &&
                row.data.outcome !== "unscored",
            )
            .map((row) => stable([row.data.skill, row.data.tag]))
            .sort(),
        );
      if (composition(baseline.entity.id) !== composition(retest.entity.id))
        reasons.push("技能或题型/标签构成不同");
      if (
        [
          ...usableAttempts.filter(
            (row) => row.data.assessmentId === baseline.entity.id,
          ),
          ...retestSamples,
        ].some((row) => row.data.item.source !== row.data.form.source)
      )
        reasons.push("题目与题卷来源不一致");
      if (
        (a.sessionId &&
          (!byId.get(a.sessionId) || byId.get(a.sessionId)!.deleted)) ||
        (b.sessionId &&
          (!byId.get(b.sessionId) || byId.get(b.sessionId)!.deleted))
      )
        reasons.push("关联练习会话不可用");
      if (exposureHistoryIncomplete) reasons.push("历史题目证据不完整");
      if (
        usableAttempts
          .filter((row) =>
            [baseline.entity.id, retest.entity.id].includes(
              row.data.assessmentId ?? "",
            ),
          )
          .some((row) => ambiguous.has(exposureKey(row.data.item)))
      )
        reasons.push("首答先后不明，不能确认这些题目未被作答");
      const comparable = reasons.length === 0,
        sampleStatus =
          baseline.sampleStatus === "insufficient" ||
          retest.sampleStatus === "insufficient"
            ? ("insufficient" as const)
            : ("descriptive-only" as const);
      comparisons.push({
        baselineId: baseline.entity.id,
        retestId: retest.entity.id,
        comparable,
        reasons,
        ...(comparable && a.score !== undefined && b.score !== undefined
          ? { scoreDelta: b.score - a.score }
          : {}),
        sampleStatus,
        conclusion:
          sampleStatus === "insufficient"
            ? "样本不足；只展示记录差异，不推断进步或学习效果。"
            : "仅为同协议下的描述性比较；虚构流程或分数变化不能证明学习效果。",
      });
    }
  const configurations = active("learning-config").map((entity) => ({
    entity,
    data: parsed.get(entity.id) as ConfigData,
    current: false,
  }));
  for (const row of configurations)
    row.current = !entities
      .filter((e) => e.type === "learning-config" && parsed.has(e.id))
      .some((e) => {
        const data = parsed.get(e.id) as ConfigData;
        return (
          data.goalId === row.data.goalId &&
          data.revision > row.data.revision &&
          normalizeLanguage(e.fields.language) ===
            normalizeLanguage(row.entity.fields.language)
        );
      });
  for (const row of configurations) {
    try {
      validateConfigChain(row.entity, (id) => byId.get(id) ?? null, entities);
    } catch (error) {
      row.current = false;
      issues.push({ entityId: row.entity.id, message: String(error) });
    }
  }
  const teacherSummaries = active("teacher-summary").map((entity) => {
    const data = parsed.get(entity.id) as TeacherData,
      revisions: LearningLoopReport["teacherSummaries"][number]["revisions"] =
        [];
    if (entity.body !== data.contract.originalText)
      issues.push({
        entityId: entity.id,
        message:
          "教师原文被外部改写；先保留外部副本，再恢复原文。刷新、同步和备份会暂停；新原文须通过教师导入提交新修订。",
      });
    for (const op of history.filter((op) => op.entityId === entity.id)) {
      try {
        const d = parseLoopData(
          entity.type,
          op.value.fields.data,
        ) as TeacherData;
        revisions.push({
          version: op.value.version,
          sourceRevision: d.contract.source.revision,
          originalText: d.contract.originalText,
          summary: d.summary,
        });
      } catch {
        issues.push({
          entityId: entity.id,
          message: "Unsupported historical teacher revision preserved",
        });
      }
    }
    return { entity, data, revisions };
  });
  return {
    kind: "inference",
    ruleVersion: "learning-loop-v1",
    uniqueTotalMinutes: [...timeOwners.values()].reduce(
      (sum, row) => sum + row.minutes,
      0,
    ),
    timeEvidence: [...timeOwners.values()],
    configurations,
    sessions,
    assessments,
    attempts,
    weaknesses,
    comparisons,
    teacherSummaries,
    methods: active("method-adjustment").map((entity) => ({
      entity,
      data: parsed.get(entity.id) as MethodData,
    })),
    issues,
    policy:
      "练习与阅读会话的时长所有者取并集；测评、题目、教师摘要不另计时。独立评分题目数与含重复的错误作答次数不是错误率的分母/分子。至少5个独立评分题目仅作为展示‘样本不足’的阈值，达到阈值仍仅描述，不证明进步；旧/删除作答历史保留最早实际时间的首答判据。目标和候选时长/周期由用户配置，不作效果承诺。",
  };
}
