import type { Snapshot, Module } from "./types.js";
import { normalizeLanguage } from "./languages.js";
import { validateLearningTimestamp } from "./learning-time.js";

export type Identity = { source: string; id: string; version: string };
export type Scale = { id: string; min: number; max: number };
export type Candidate = {
  minutesMin: number;
  minutesMax: number;
  retestWeeksMin: number;
  retestWeeksMax: number;
};
export type ConfigData = {
  protocol: 1;
  goalId: string;
  scale: Scale;
  targetScore: number;
  reason: string;
  revision: number;
  previousId?: string;
  candidate?: Candidate;
};
export type SessionData = { protocol: 1; readingSessionId?: string };
export type AssessmentData = {
  protocol: 1;
  phase: "baseline" | "checkpoint" | "retest";
  category: "official" | "mock" | "practice";
  sessionId?: string;
  evaluation: Identity;
  scale: Scale;
  form: Identity;
  difficulty: string;
  conditions: string;
  score?: number;
  scoreReference?: string;
};
export type AttemptData = {
  protocol: 1;
  sessionId: string;
  assessmentId?: string;
  item: Identity;
  form: Identity;
  skill: "听" | "说" | "读" | "写";
  tag: string;
  answer: string;
  outcome: "correct" | "incorrect" | "unscored";
  errorType?: string;
};
export type TeacherContract = {
  protocol: "life-os-teacher-summary-v1";
  source: { namespace: string; id: string; revision: number };
  language: string;
  occurredAt: string;
  timeZone: string;
  originalText: string;
  summary: string;
  modality: "text" | "chat-transcript" | "human-audio-observation";
  recommendations: string[];
  sessionIds: string[];
  goalIds: string[];
};
export type TeacherData = {
  protocol: 1;
  contract: TeacherContract;
  summary: string;
};
export type MethodData = {
  protocol: 1;
  method: string;
  reason: string;
  evidenceIds: string[];
  candidate?: Candidate;
  proposalId?: string;
  previousId?: string;
};
export const LOOP_TYPES = [
  "learning-config",
  "assessment",
  "attempt",
  "teacher-summary",
  "method-adjustment",
];
export const hasLearningLoop = (module: Module) =>
  module.id === "languages" &&
  module.schemaVersion === 4 &&
  module.learningLoopProtocol === 1 &&
  LOOP_TYPES.every((type) =>
    module.entityTypes.some(
      (t) =>
        t.id === type &&
        t.fields.some(
          (f) => f.key === "data" && f.type === "text" && f.required,
        ) &&
        t.fields.some(
          (f) => f.key === "language" && f.type === "text" && f.required,
        ),
    ),
  ) &&
  module.entityTypes.some(
    (t) =>
      t.id === "practice" &&
      t.fields.some((f) => f.key === "learningData" && f.type === "text"),
  );
export const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonical(item)]),
        )
      : value;
export const stable = (value: unknown) => JSON.stringify(canonical(value));
export const identityKey = (identity: Identity) => stable(identity);
// A publisher revising an item does not make its content unexposed.
export const exposureKey = (identity: Identity) =>
  stable([identity.source, identity.id]);
type ConfigRecord = Pick<Snapshot, "id" | "module" | "type" | "fields">;
/** Tombstones remain members of the chain; removal cannot authorize a fork. */
export function validateConfigChain(
  record: ConfigRecord,
  lookup: (id: string) => ConfigRecord | null,
  records: ConfigRecord[],
) {
  const config = parseLoopData(
    "learning-config",
    record.fields.data,
  ) as ConfigData;
  const language = normalizeLanguage(record.fields.language);
  const members = [...records.filter((row) => row.id !== record.id), record]
    .filter(
      (row) => row.module === "languages" && row.type === "learning-config",
    )
    .filter((row) => normalizeLanguage(row.fields.language) === language)
    .map((row) => ({
      row,
      data: parseLoopData("learning-config", row.fields.data) as ConfigData,
    }))
    .filter(({ data }) => data.goalId === config.goalId);
  const roots = members.filter(({ data }) => !data.previousId);
  if (roots.length !== 1 || roots[0].data.revision !== 1)
    throw Error(
      "Config history conflict: exactly one revision 1 root per goal and language required",
    );
  const successors = new Set<string>();
  for (const { row, data } of members) {
    if (!data.previousId) continue;
    const parent = lookup(data.previousId);
    if (
      !parent ||
      parent.module !== "languages" ||
      parent.type !== "learning-config"
    )
      throw Error("Config history conflict: parent configuration missing");
    const previous = parseLoopData(
      "learning-config",
      parent.fields.data,
    ) as ConfigData;
    if (
      parent.id === row.id ||
      previous.goalId !== data.goalId ||
      normalizeLanguage(parent.fields.language) !== language ||
      data.revision !== previous.revision + 1
    )
      throw Error(
        "Config history conflict: parent goal/language and consecutive revision must match",
      );
    if (successors.has(parent.id))
      throw Error(
        "Config history conflict: concurrent successors require review; forks are rejected",
      );
    successors.add(parent.id);
  }
}
export type LoopValidationContext = {
  prior: Snapshot | null;
  records: ConfigRecord[];
  historical?: boolean;
  sourceImport?: boolean;
  teacherResolution?: boolean;
  moduleEnabled: (module: string) => boolean;
  teacherContract: (contract: TeacherContract) => TeacherContract | null;
};
export function object(
  value: unknown,
  keys: string[],
  required = keys,
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    required.some((key) => !(key in value))
  )
    throw Error("Invalid learning object or unknown field (no data written)");
}
export function text(
  value: unknown,
  name: string,
  max = 1000,
): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw Error("Invalid learning " + name);
}
export function id(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(value))
    throw Error("Invalid learning entity/operation ID");
}
export function strings(value: unknown, name: string, ids = false) {
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    new Set(value).size !== value.length
  )
    throw Error("Invalid learning " + name);
  for (const item of value) {
    if (ids) id(item);
    else text(item, name);
  }
}
export function number(value: unknown, min: number, max: number) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw Error("Invalid learning numeric range");
}
export function identity(value: unknown) {
  object(value, ["source", "id", "version"]);
  text(value.source, "identity source", 300);
  text(value.id, "identity ID", 300);
  text(value.version, "identity version", 100);
}
export function scale(value: unknown): asserts value is Scale {
  object(value, ["id", "min", "max"]);
  text(value.id, "scale ID");
  number(value.min, -1000000, 1000000);
  number(value.max, -1000000, 1000000);
  if (Number(value.min) >= Number(value.max))
    throw Error("Invalid learning scale bounds");
}
export function candidate(value: unknown) {
  if (value === undefined) return;
  object(value, [
    "minutesMin",
    "minutesMax",
    "retestWeeksMin",
    "retestWeeksMax",
  ]);
  number(value.minutesMin, 1, 1440);
  number(value.minutesMax, Number(value.minutesMin), 1440);
  number(value.retestWeeksMin, 0.1, 104);
  number(value.retestWeeksMax, Number(value.retestWeeksMin), 104);
}
export function teacher(value: unknown): asserts value is TeacherContract {
  object(value, [
    "protocol",
    "source",
    "language",
    "occurredAt",
    "timeZone",
    "originalText",
    "summary",
    "modality",
    "recommendations",
    "sessionIds",
    "goalIds",
  ]);
  if (value.protocol !== "life-os-teacher-summary-v1")
    throw Error(
      "Unsupported teacher contract protocol; preserve the file and use version v1",
    );
  object(value.source, ["namespace", "id", "revision"]);
  text(value.source.namespace, "teacher source", 100);
  text(value.source.id, "teacher source ID", 100);
  if (
    !Number.isSafeInteger(value.source.revision) ||
    Number(value.source.revision) < 1
  )
    throw Error("Teacher revision must be a positive integer");
  if (!normalizeLanguage(value.language))
    throw Error("Invalid teacher language");
  text(value.occurredAt, "teacher timestamp");
  text(value.timeZone, "teacher zone");
  text(value.originalText, "teacher original", 10000);
  text(value.summary, "teacher summary", 5000);
  if (
    !["text", "chat-transcript", "human-audio-observation"].includes(
      String(value.modality),
    )
  )
    throw Error(
      "Invalid teacher modality; chat transcription cannot be a pronunciation score",
    );
  strings(value.recommendations, "recommendations");
  strings(value.sessionIds, "sessions", true);
  strings(value.goalIds, "goals", true);
}
export function parseLoopData(
  type: string,
  encoded: unknown,
):
  | ConfigData
  | SessionData
  | AssessmentData
  | AttemptData
  | TeacherData
  | MethodData {
  if (typeof encoded !== "string" || encoded.length > 20000)
    throw Error("Invalid learning JSON");
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(encoded);
  } catch {
    throw Error("Invalid learning JSON");
  }
  if (type === "practice") {
    object(d, ["protocol", "readingSessionId"], ["protocol"]);
    if (d.readingSessionId !== undefined) id(d.readingSessionId);
  } else if (type === "learning-config") {
    object(
      d,
      [
        "protocol",
        "goalId",
        "scale",
        "targetScore",
        "reason",
        "revision",
        "previousId",
        "candidate",
      ],
      ["protocol", "goalId", "scale", "targetScore", "reason", "revision"],
    );
    id(d.goalId);
    scale(d.scale);
    number(d.targetScore, d.scale.min, d.scale.max);
    text(d.reason, "target reason");
    if (!Number.isSafeInteger(d.revision) || Number(d.revision) < 1)
      throw Error("Invalid target revision");
    if (d.previousId !== undefined) id(d.previousId);
    candidate(d.candidate);
  } else if (type === "assessment") {
    object(
      d,
      [
        "protocol",
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
      ],
      [
        "protocol",
        "phase",
        "category",
        "evaluation",
        "scale",
        "form",
        "difficulty",
        "conditions",
      ],
    );
    if (
      !["baseline", "checkpoint", "retest"].includes(String(d.phase)) ||
      !["official", "mock", "practice"].includes(String(d.category))
    )
      throw Error("Invalid assessment phase/category");
    if (d.sessionId !== undefined) id(d.sessionId);
    if (d.category !== "official" && d.sessionId === undefined)
      throw Error("Mock/practice assessment requires a practice session");
    identity(d.evaluation);
    identity(d.form);
    scale(d.scale);
    text(d.difficulty, "difficulty");
    text(d.conditions, "conditions");
    if (d.score !== undefined) {
      number(d.score, d.scale.min, d.scale.max);
      text(d.scoreReference, "score source");
    } else if (d.scoreReference !== undefined)
      throw Error("Score reference requires a reported score");
    if (d.category === "official" && d.score === undefined)
      throw Error(
        "Official record requires a reported score and source; no score conversion",
      );
  } else if (type === "attempt") {
    object(
      d,
      [
        "protocol",
        "sessionId",
        "assessmentId",
        "item",
        "form",
        "skill",
        "tag",
        "answer",
        "outcome",
        "errorType",
      ],
      [
        "protocol",
        "sessionId",
        "item",
        "form",
        "skill",
        "tag",
        "answer",
        "outcome",
      ],
    );
    id(d.sessionId);
    if (d.assessmentId !== undefined) id(d.assessmentId);
    identity(d.item);
    identity(d.form);
    if (
      !["听", "说", "读", "写"].includes(String(d.skill)) ||
      !["correct", "incorrect", "unscored"].includes(String(d.outcome))
    )
      throw Error("Invalid learning attempt skill/outcome");
    text(d.tag, "item tag");
    text(d.answer, "answer", 5000);
    if (d.errorType !== undefined) text(d.errorType, "error type");
    if (d.outcome === "incorrect" && d.errorType === undefined)
      throw Error("Incorrect answer requires an error type");
  } else if (type === "teacher-summary") {
    object(d, ["protocol", "contract", "summary"]);
    teacher(d.contract);
    text(d.summary, "edited summary", 5000);
  } else if (type === "method-adjustment") {
    object(
      d,
      [
        "protocol",
        "method",
        "reason",
        "evidenceIds",
        "candidate",
        "proposalId",
        "previousId",
      ],
      ["protocol", "method", "reason", "evidenceIds"],
    );
    text(d.method, "method", 5000);
    text(d.reason, "method reason", 3000);
    strings(d.evidenceIds, "method evidence", true);
    if (!(d.evidenceIds as string[]).length)
      throw Error("Method proposal requires actual evidence");
    candidate(d.candidate);
    if (d.proposalId !== undefined) id(d.proposalId);
    if (d.previousId !== undefined) id(d.previousId);
  } else throw Error("Unknown learning record type");
  if (d.protocol !== 1)
    throw Error("Unsupported learning data protocol; original data preserved");
  return d as unknown as
    | ConfigData
    | SessionData
    | AssessmentData
    | AttemptData
    | TeacherData
    | MethodData;
}
/** Shared by all Store writes, including generic HTTP, sync and source imports. */
export function validateLoopSnapshot(
  s: Snapshot,
  lookup: (id: string) => Snapshot | null,
  context: LoopValidationContext,
) {
  if (
    s.module !== "languages" ||
    s.schemaVersion !== 4 ||
    (!LOOP_TYPES.includes(s.type) &&
      !(s.type === "practice" && s.fields.learningData !== undefined))
  )
    return;
  if (!normalizeLanguage(s.fields.language))
    throw Error("Invalid learning language");
  validateLearningTimestamp(s.occurredAt, s.timeZone);
  const d = parseLoopData(
    s.type,
    s.fields[s.type === "practice" ? "learningData" : "data"],
  );
  const prior = context.prior;
  if (
    prior?.module === "languages" &&
    prior.type === s.type &&
    prior.fields[s.type === "practice" ? "learningData" : "data"] !== undefined
  ) {
    const previous = parseLoopData(
      s.type,
      prior.fields[s.type === "practice" ? "learningData" : "data"],
    );
    if (
      s.type === "learning-config" &&
      (stable(previous) !== stable(d) ||
        normalizeLanguage(prior.fields.language) !==
          normalizeLanguage(s.fields.language))
    )
      throw Error(
        "Learning configurations are immutable; append a new configuration to preserve target history",
      );
    if (s.type === "attempt") {
      const a = previous as AttemptData,
        b = d as AttemptData;
      if (
        identityKey(a.item) !== identityKey(b.item) ||
        identityKey(a.form) !== identityKey(b.form) ||
        a.sessionId !== b.sessionId ||
        a.assessmentId !== b.assessmentId
      )
        throw Error(
          "Attempt identity/session/form immutable; exposure history is retained",
        );
    }
    if (s.type === "assessment") {
      const a = previous as AssessmentData,
        b = d as AssessmentData;
      if (
        identityKey(a.form) !== identityKey(b.form) ||
        a.sessionId !== b.sessionId ||
        a.category !== b.category
      )
        throw Error(
          "Assessment session/form/category immutable; preserve item linkage",
        );
    }
    if (s.type === "teacher-summary") {
      const a = (previous as TeacherData).contract,
        b = (d as TeacherData).contract;
      if (
        a.source.namespace !== b.source.namespace ||
        a.source.id !== b.source.id ||
        (a.source.revision === b.source.revision && stable(a) !== stable(b))
      )
        throw Error(
          "Teacher source/original contract immutable within a revision",
        );
      if (
        !context.historical &&
        a.source.revision !== b.source.revision &&
        (!context.sourceImport ||
          (b.source.revision <= a.source.revision &&
            !context.teacherResolution))
      )
        throw Error(
          "Teacher source revision cannot roll back and requires the source import operation",
        );
    }
  }
  const hasLink = (type: string, target: string) =>
    s.relations.some((r) => r.type === type && r.target === target);
  const linked = (targetId: string, types: string[], module?: string) => {
    const target = lookup(targetId);
    if (
      !target ||
      !types.includes(target.type) ||
      (module && target.module !== module) ||
      (target.deleted &&
        !context.historical &&
        !prior?.relations.some((r) => r.target === targetId))
    )
      throw Error("Invalid/deleted learning relation target");
    if (
      !context.historical &&
      !prior?.relations.some((r) => r.target === targetId) &&
      !context.moduleEnabled(target.module)
    )
      throw Error("Module disabled; new learning relations are not allowed");
    return target;
  };
  const sameLanguage = (target: {
    fields: Record<string, string | number>;
  }) => {
    if (
      normalizeLanguage(target.fields.language) !==
      normalizeLanguage(s.fields.language)
    )
      throw Error("Learning relation language mismatch");
  };
  const completedSession = (targetId: string) => {
    const target = linked(targetId, ["practice"], "languages");
    sameLanguage(target);
    if (target.kind !== "fact" || target.status !== "done")
      throw Error("Learning relation requires a completed factual practice");
    return target;
  };
  for (const r of s.relations.filter((r) => r.type === "supports")) {
    const target = linked(r.target, ["goal", "language-goal", "direction"]);
    if (
      target.kind !== "plan" ||
      (!context.historical &&
        !prior?.relations.some(
          (old) => old.type === "supports" && old.target === target.id,
        ) &&
        target.status !== "active")
    )
      throw Error("Learning supports relation requires an active plan goal");
  }
  if (s.type === "practice") {
    if (s.kind !== "fact" || s.status !== "done")
      throw Error("Learning session must be a completed fact");
    const readingId = (d as SessionData).readingSessionId;
    if (readingId) {
      const reading = linked(readingId, ["session"], "learning");
      const retained =
        prior?.fields.learningData !== undefined &&
        (parseLoopData("practice", prior.fields.learningData) as SessionData)
          .readingSessionId === readingId &&
        prior.relations.some(
          (r) => r.type === "evidence" && r.target === readingId,
        );
      if (
        !context.historical &&
        !retained &&
        (reading.deleted || !context.moduleEnabled("learning"))
      )
        throw Error(
          "Deleted or disabled reading session cannot establish a new duration link",
        );
      sameLanguage(reading);
      if (
        reading.kind !== "fact" ||
        reading.status !== "done" ||
        !hasLink("evidence", readingId) ||
        s.fields.minutes !== undefined
      )
        throw Error("Linked completed reading session owns the only duration");
    } else number(s.fields.minutes, 0.01, 1440);
  }
  if (s.type === "learning-config") {
    if (s.kind !== "plan") throw Error("Learning config is a plan");
    const config = d as ConfigData;
    const goal = linked(config.goalId, ["goal", "language-goal", "direction"]);
    if (
      goal.kind !== "plan" ||
      !s.relations.some((r) => r.type === "supports" && r.target === goal.id)
    )
      throw Error("Config must support an existing goal");
    if (goal.type === "language-goal") sameLanguage(goal);
    validateConfigChain(s, lookup, context.records);
  }
  if (s.type === "assessment") {
    if (s.kind !== "fact" || s.status !== "done")
      throw Error("Assessment must be a completed fact");
    const assessment = d as AssessmentData;
    if (assessment.sessionId) {
      completedSession(assessment.sessionId);
      if (!hasLink("evidence", assessment.sessionId))
        throw Error("Assessment data requires matching session relation");
    }
  }
  if (s.type === "attempt") {
    if (s.kind !== "fact" || s.status !== "done")
      throw Error("Attempt must be a completed fact");
    const attempt = d as AttemptData;
    completedSession(attempt.sessionId);
    if (!hasLink("evidence", attempt.sessionId))
      throw Error("Attempt data requires matching session relation");
    if (attempt.assessmentId) {
      const assessment = linked(
        attempt.assessmentId,
        ["assessment"],
        "languages",
      );
      sameLanguage(assessment);
      const a = parseLoopData(
        "assessment",
        assessment.fields.data,
      ) as AssessmentData;
      if (
        assessment.kind !== "fact" ||
        assessment.status !== "done" ||
        a.category === "official" ||
        a.sessionId !== attempt.sessionId ||
        identityKey(a.form) !== identityKey(attempt.form) ||
        !hasLink("evidence", attempt.assessmentId)
      )
        throw Error(
          "Attempt session/form/relation must match a factual non-official assessment",
        );
    }
  }
  if (s.type === "teacher-summary") {
    const contract = (d as TeacherData).contract;
    if (!prior && !context.historical && !context.sourceImport)
      throw Error(
        "New teacher summaries require the source import operation and receipt",
      );
    const preserved = context.teacherContract(contract);
    if (preserved && stable(preserved) !== stable(contract))
      throw Error(
        "Teacher preserved source contract differs from its revision history",
      );
    if (
      s.occurredAt !== contract.occurredAt ||
      s.timeZone !== contract.timeZone
    )
      throw Error(
        "Teacher event timestamp/zone must match the preserved contract",
      );
    if (
      s.source.mode === "import" &&
      (s.source.namespace !== "learning-teacher:" + contract.source.namespace ||
        s.source.recordId !== contract.source.id ||
        s.source.revision !== String(contract.source.revision))
    )
      throw Error(
        "Teacher source receipt must match the preserved contract identity/revision",
      );
    if (
      !context.historical &&
      !context.teacherResolution &&
      s.source.mode !== "import" &&
      (!prior ||
        (s.version > prior.version &&
          prior.fields.data &&
          (parseLoopData("teacher-summary", prior.fields.data) as TeacherData)
            .contract.source.revision !== contract.source.revision))
    )
      throw Error(
        "New teacher source revisions require the reviewed import channel",
      );
    if (s.kind !== "inference" || s.status !== "draft")
      throw Error("Teacher summary is an unverified draft inference");
    sameLanguage({ fields: { language: contract.language } });
    if (s.body !== contract.originalText)
      throw Error("Teacher original text must match the preserved contract");
    for (const sessionId of contract.sessionIds) {
      completedSession(sessionId);
      if (!hasLink("evidence", sessionId))
        throw Error("Teacher session data requires matching relations");
    }
    if (
      stable(
        s.relations
          .filter((r) => r.type === "supports")
          .map((r) => r.target)
          .sort(),
      ) !== stable([...contract.goalIds].sort())
    )
      throw Error("Teacher goal data requires matching relations");
  }
  if (s.type === "method-adjustment") {
    const method = d as MethodData;
    if (
      !(s.kind === "inference" && s.status === "draft") &&
      !(s.kind === "plan" && ["active", "done", "failed"].includes(s.status))
    )
      throw Error("Method needs an unverified draft or a human adopted plan");
    for (const evidenceId of method.evidenceIds) {
      const evidence = lookup(evidenceId);
      if (
        !evidence ||
        evidence.kind === "plan" ||
        !s.relations.some(
          (r) => r.type === "evidence" && r.target === evidenceId,
        )
      )
        throw Error("Method requires actual linked evidence");
    }
    if (s.kind === "plan") {
      if (!method.proposalId) throw Error("Adopted method requires a proposal");
      linked(method.proposalId, ["method-adjustment"], "languages");
    }
  }
}
