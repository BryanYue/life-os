import { Store } from "./store.js";
import {
  HUMAN,
  type Capability,
  type Entity,
  type EntityInput,
  type Operation,
} from "./types.js";
import { hash } from "./vault.js";
import {
  LANGUAGE_CATALOG,
  languageLabel,
  languageDisplayLabels,
  normalizeLanguage,
  type LanguageDefinition,
} from "./languages.js";

export type ReadingLanguage = string;
export type ReadingSourceType =
  "技术文档" | "新闻" | "剧相关文字" | "社交文字" | "其他";
export type ReadingRights =
  "虚构样例" | "本人创作" | "获准导入" | "公有领域" | "合法摘录";
export type ReadingRequest = {
  operationId: string;
  occurredAt: string;
  timeZone: string;
};
export type CreateReadingMaterialInput = ReadingRequest & {
  title: string;
  reference: string;
  sourceType: ReadingSourceType;
  language: ReadingLanguage;
  rights: ReadingRights;
  body: string;
};
export type RecordReadingInput = ReadingRequest & {
  materialId: string;
  minutes: number;
  goalIds: string[];
  takeaway?: string;
  body?: string;
};
export type ReadingExplanationInput = ReadingRequest & {
  materialId: string;
  sessionId?: string;
  text: string;
  reference?: string;
  quote?: string;
  goalIds?: string[];
};
export type ReadingVocabularyInput = ReadingRequest & {
  materialId: string;
  sessionId: string;
  term: string;
  meaning: string;
  context: string;
  reference?: string;
  due?: string;
  goalIds?: string[];
};
export type ReadingIssue = { entityId: string; code: string; message: string };
export type ReadingReport = {
  uniqueTotalMinutes: number;
  byLanguage: { language: string; minutes: number; evidenceIds: string[] }[];
  byLanguageCode: {
    code: string;
    language: string;
    minutes: number;
    evidenceIds: string[];
  }[];
  byGoal: {
    goalId: string;
    title: string;
    module: string;
    minutes: number;
    evidenceIds: string[];
  }[];
  byDomain: { domain: string; minutes: number; evidenceIds: string[] }[];
  materials: {
    entity: Entity;
    sessionIds: string[];
    explanationIds: string[];
    vocabularyIds: string[];
  }[];
  sessions: {
    entity: Entity;
    materialId: string | null;
    goalIds: string[];
    counted: boolean;
  }[];
  explanations: {
    entity: Entity;
    materialId: string | null;
    sessionId: string | null;
  }[];
  vocabulary: {
    entity: Entity;
    materialId: string | null;
    sessionId: string | null;
  }[];
  issues: ReadingIssue[];
  viewTotalsAdditive: false;
  countingPolicy: string;
};
const sourceTypes = ["技术文档", "新闻", "剧相关文字", "社交文字", "其他"];
const rightsValues = [
  "虚构样例",
  "本人创作",
  "获准导入",
  "公有领域",
  "合法摘录",
];
function text(
  value: unknown,
  label: string,
  max = 20000,
): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw Error("Invalid reading " + label);
}
function optionalText(value: unknown, label: string, max = 20000) {
  if (value !== undefined && (typeof value !== "string" || value.length > max))
    throw Error("Invalid reading " + label);
}
function request(input: ReadingRequest) {
  if (
    !input ||
    typeof input.operationId !== "string" ||
    !/^[a-zA-Z0-9-]{1,100}$/.test(input.operationId)
  )
    throw Error("Invalid reading operation ID");
  text(input.occurredAt, "date");
  text(input.timeZone, "time zone");
}
function languageValue(
  store: Store,
  module: string,
  type: string,
  value: string,
) {
  const code = normalizeLanguage(value);
  if (!code) throw Error("Invalid reading language");
  const field = store
    .module(module)
    .entityTypes.find((item) => item.id === type)
    ?.fields.find((item) => item.key === "language");
  if (field?.type === "select") {
    const legacy = field.options?.find(
      (option) => normalizeLanguage(option) === code,
    );
    if (!legacy)
      throw Error(
        `Reading language requires an explicit ${module} language schema upgrade`,
      );
    return legacy;
  }
  return LANGUAGE_CATALOG.some((item) => item.legacyValues?.includes(value))
    ? value
    : code;
}
function material(store: Store, id: string, cap: Capability) {
  text(id, "material ID", 100);
  const entity = store.get(id, cap);
  if (
    !entity ||
    entity.deleted ||
    entity.module !== "learning" ||
    entity.type !== "material" ||
    entity.kind !== "fact"
  )
    throw Error("Reading requires an existing factual material");
  if (!normalizeLanguage(entity.fields.language))
    throw Error("Reading material requires a supported language");
  if (
    !sourceTypes.includes(String(entity.fields.sourceType)) ||
    !rightsValues.includes(String(entity.fields.rights))
  )
    throw Error(
      "Reading material requires declared source type and rights metadata",
    );
  text(entity.fields.reference, "material reference");
  return entity;
}
function goals(store: Store, ids: string[], cap: Capability): Entity[] {
  if (
    !Array.isArray(ids) ||
    ids.length > 96 ||
    ids.some((id) => typeof id !== "string")
  )
    throw Error("Invalid reading goal selection");
  return [...new Set(ids)].sort().map((id) => {
    const target = store.get(id, cap);
    if (
      !target ||
      target.deleted ||
      target.kind !== "plan" ||
      target.status !== "active" ||
      !["goal", "direction", "language-goal"].includes(target.type)
    )
      throw Error("Reading requires active plan goals or directions");
    return target;
  });
}
function session(store: Store, id: string, source: Entity, cap: Capability) {
  const entity = store.get(id, cap);
  if (
    !entity ||
    entity.deleted ||
    entity.module !== "learning" ||
    entity.type !== "session" ||
    entity.kind !== "fact" ||
    entity.status !== "done" ||
    !entity.relations.some(
      (r) => r.type === "evidence" && r.target === source.id,
    )
  )
    throw Error(
      "Reading support record requires a completed session for this material",
    );
  if (
    normalizeLanguage(entity.fields.language) !==
    normalizeLanguage(source.fields.language)
  )
    throw Error("Reading session and material languages differ");
  return entity;
}
function supported(targets: Entity[]) {
  return targets.map((goal) => ({ type: "supports", target: goal.id }));
}
function evidence(source: Entity, reading?: Entity) {
  return [
    { type: "evidence", target: source.id },
    ...(reading ? [{ type: "evidence", target: reading.id }] : []),
  ];
}
function provenance(source: Entity, reference?: string) {
  return `原文记录：${source.id}\n原文版本：${source.version}\n来源引用：${reference ?? source.fields.reference}`;
}
function requestRevision(input: ReadingRequest) {
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
  return "request-" + hash(JSON.stringify(canonical(input)));
}
function replay(
  store: Store,
  input: ReadingRequest,
  module: string,
  type: string,
  cap: Capability,
): Entity | null {
  const row = store.db
    .prepare("SELECT json FROM operations WHERE id=?")
    .get(input.operationId);
  if (!row) return null;
  const operation = JSON.parse(String(row.json)) as Operation,
    saved = operation.value;
  if (
    operation.base ||
    saved.module !== module ||
    saved.type !== type ||
    saved.source.namespace !== "local-reading-v1" ||
    saved.source.revision !== requestRevision(input)
  )
    throw Error("Operation ID reused with different content");
  // Reconstruct the original request, rather than deriving it from a material
  // or goal that may have been edited since. Store still enforces its original
  // receipt digest, permissions and scope, and returns the current entity.
  const {
    id,
    module: savedModule,
    type: savedType,
    title,
    kind,
    status,
    occurredAt,
    timeZone,
    fields,
    relations,
    body,
    source,
  } = saved;
  return store.saveMany(
    [
      {
        operationId: input.operationId,
        expectedVersion: 0,
        entity: {
          id,
          module: savedModule,
          type: savedType,
          title,
          kind,
          status,
          occurredAt,
          timeZone,
          fields,
          relations,
          body,
          source,
        },
      },
    ],
    cap,
  )[0];
}
function persist(
  store: Store,
  input: ReadingRequest,
  entity: EntityInput,
  cap: Capability,
) {
  const id = hash(
    JSON.stringify([
      "reading-v1",
      entity.module,
      entity.type,
      input.operationId,
    ]),
  );
  return store.saveMany(
    [
      {
        operationId: input.operationId,
        expectedVersion: 0,
        entity: {
          ...entity,
          id,
          source: {
            namespace: "local-reading-v1",
            recordId: id,
            revision: requestRevision(input),
            mode: cap.role === "ai" ? "rule" : "manual",
          },
        },
      },
    ],
    cap,
  )[0];
}

export function createReadingMaterial(
  store: Store,
  input: CreateReadingMaterialInput,
  cap = HUMAN,
): Entity {
  request(input);
  text(input.title, "title", 300);
  text(input.reference, "reference");
  text(input.body, "original text", 200000);
  const languageCode = normalizeLanguage(input.language);
  if (!languageCode) throw Error("Invalid reading language");
  if (!sourceTypes.includes(input.sourceType))
    throw Error("Invalid reading source type");
  if (!rightsValues.includes(input.rights))
    throw Error("Invalid reading rights metadata");
  const prior = replay(store, input, "learning", "material", cap);
  if (prior) return prior;
  const language = languageValue(store, "learning", "material", input.language);
  return persist(
    store,
    input,
    {
      module: "learning",
      type: "material",
      title: input.title,
      kind: "fact",
      status: "done",
      occurredAt: input.occurredAt,
      timeZone: input.timeZone,
      fields: {
        reference: input.reference,
        sourceType: input.sourceType,
        language,
        rights: input.rights,
      },
      relations: [],
      body: input.body,
    },
    cap,
  );
}

export function recordReading(
  store: Store,
  input: RecordReadingInput,
  cap = HUMAN,
): Entity {
  request(input);
  if (
    typeof input.minutes !== "number" ||
    !Number.isFinite(input.minutes) ||
    input.minutes <= 0
  )
    throw Error("Reading minutes must be positive and finite");
  optionalText(input.takeaway, "takeaway");
  optionalText(input.body, "session body", 180000);
  const prior = replay(store, input, "learning", "session", cap);
  if (prior) return prior;
  const source = material(store, input.materialId, cap),
    targets = goals(store, input.goalIds, cap);
  return persist(
    store,
    input,
    {
      module: "learning",
      type: "session",
      title: "综合阅读 · " + source.title.slice(0, 290),
      kind: "fact",
      status: "done",
      occurredAt: input.occurredAt,
      timeZone: input.timeZone,
      fields: {
        minutes: input.minutes,
        language: source.fields.language,
        activity: "综合阅读",
        takeaway: input.takeaway ?? "",
      },
      relations: [...evidence(source), ...supported(targets)],
      body: (input.body ?? "") + "\n\n" + provenance(source),
    },
    cap,
  );
}

export function addReadingExplanation(
  store: Store,
  input: ReadingExplanationInput,
  cap = HUMAN,
): Entity {
  request(input);
  text(input.text, "explanation", 180000);
  optionalText(input.reference, "explanation reference");
  optionalText(input.quote, "quote");
  const prior = replay(store, input, "learning", "note", cap);
  if (prior) return prior;
  const source = material(store, input.materialId, cap),
    reading = input.sessionId
      ? session(store, input.sessionId, source, cap)
      : undefined;
  if (input.quote && !source.body.includes(input.quote))
    throw Error("Reading quotation must occur in the original text");
  const goalIds =
    input.goalIds ??
    reading?.relations
      .filter((r) => r.type === "supports")
      .map((r) => r.target) ??
    [];
  const targets = goals(store, goalIds, cap);
  return persist(
    store,
    input,
    {
      module: "learning",
      type: "note",
      title: "辅助解释 · " + source.title.slice(0, 290),
      kind: "inference",
      status: "draft",
      occurredAt: input.occurredAt,
      timeZone: input.timeZone,
      fields: { noteType: "辅助解释", topic: "阅读理解辅助；待核对" },
      relations: [...evidence(source, reading), ...supported(targets)],
      body:
        input.text +
        (input.quote
          ? "\n\n原文摘录：\n> " + input.quote.split("\n").join("\n> ")
          : "") +
        "\n\n" +
        provenance(source, input.reference),
    },
    cap,
  );
}

export function addReadingVocabulary(
  store: Store,
  input: ReadingVocabularyInput,
  cap = HUMAN,
): Entity {
  if (!store.module("languages", false).enabled)
    throw Error(
      "Reading vocabulary requires the languages module to be enabled; data preserved",
    );
  request(input);
  text(input.term, "vocabulary term");
  text(input.meaning, "vocabulary meaning");
  text(input.context, "vocabulary context");
  optionalText(input.reference, "vocabulary reference");
  optionalText(input.due, "revision date");
  const prior = replay(store, input, "languages", "revision", cap);
  if (prior) return prior;
  const source = material(store, input.materialId, cap),
    reading = session(store, input.sessionId, source, cap);
  const goalIds =
    input.goalIds ??
    reading.relations.filter((r) => r.type === "supports").map((r) => r.target);
  const targets = goals(store, goalIds, cap);
  return persist(
    store,
    input,
    {
      module: "languages",
      type: "revision",
      title: "阅读词汇 · " + input.term.slice(0, 290),
      kind: "fact",
      status: "active",
      occurredAt: input.occurredAt,
      timeZone: input.timeZone,
      fields: {
        language: languageValue(
          store,
          "languages",
          "revision",
          String(reading.fields.language),
        ),
        term: input.term,
        meaning: input.meaning,
        context: input.context,
        reference: input.reference ?? String(source.fields.reference),
        prompt: input.term + " → " + input.meaning,
        ...(input.due ? { due: input.due } : {}),
      },
      relations: [...evidence(source, reading), ...supported(targets)],
      body: provenance(source, input.reference),
    },
    cap,
  );
}

export function readingReport(
  entities: Entity[],
  catalog: readonly LanguageDefinition[] = LANGUAGE_CATALOG,
): ReadingReport {
  const unique = new Map<string, Entity>();
  for (const entity of entities) {
    const prior = unique.get(entity.id);
    if (
      !prior ||
      entity.version > prior.version ||
      (entity.version === prior.version && entity.deleted)
    )
      unique.set(entity.id, entity);
  }
  const visible = [...unique.values()].filter((e) => !e.deleted),
    lookup = new Map(visible.map((e) => [e.id, e]));
  const sourceMaterial = (e: Entity) =>
    e.relations
      .filter((r) => r.type === "evidence")
      .map((r) => lookup.get(r.target))
      .filter(
        (target): target is Entity =>
          !!target &&
          target.module === "learning" &&
          target.type === "material",
      );
  const rawSessions = visible.filter(
    (e) =>
      e.module === "learning" &&
      e.type === "session" &&
      (e.fields.activity === "综合阅读" || sourceMaterial(e).length > 0),
  );
  const rawMaterials = visible.filter(
    (e) =>
      e.module === "learning" &&
      e.type === "material" &&
      (e.source?.namespace === "local-reading-v1" ||
        Object.hasOwn(e.fields, "rights") ||
        rawSessions.some((s) => sourceMaterial(s).some((m) => m.id === e.id))),
  );
  const rawExplanations = visible.filter(
    (e) =>
      e.module === "learning" &&
      e.type === "note" &&
      e.fields.noteType === "辅助解释",
  );
  const rawVocabulary = visible.filter(
    (e) =>
      e.module === "languages" &&
      e.type === "revision" &&
      (e.source?.namespace === "local-reading-v1" ||
        (Object.hasOwn(e.fields, "term") && sourceMaterial(e).length > 0)),
  );
  const issues: ReadingIssue[] = [];
  const issue = (entity: Entity, code: string, message: string) =>
    issues.push({ entityId: entity.id, code, message });
  for (const e of [
    ...rawMaterials,
    ...rawSessions,
    ...rawExplanations,
    ...rawVocabulary,
  ]) {
    if (!e.source?.namespace || !e.source.recordId || !e.source.revision)
      issue(e, "missing-source", "来源身份不完整");
  }
  for (const e of rawMaterials) {
    if (!e.fields.reference) issue(e, "missing-reference", "原文缺少来源引用");
    if (!rightsValues.includes(String(e.fields.rights)))
      issue(e, "missing-rights", "原文缺少用户声明的内容授权元数据");
  }
  const relationIds = (e: Entity) => {
    const materials = sourceMaterial(e);
    if (materials.length !== 1)
      issue(e, "material-link", "应有一个可追溯的原文关系");
    const sessions = e.relations
      .filter((r) => r.type === "evidence")
      .map((r) => lookup.get(r.target))
      .filter(
        (target): target is Entity =>
          !!target && target.module === "learning" && target.type === "session",
      );
    return {
      materialId: materials.length === 1 ? materials[0].id : null,
      sessionId: sessions.length === 1 ? sessions[0].id : null,
    };
  };
  const languageGroups = new Map<
    string,
    { minutes: number; evidenceIds: string[] }
  >();
  const goalGroups = new Map<
    string,
    {
      goalId: string;
      title: string;
      module: string;
      minutes: number;
      evidenceIds: string[];
    }
  >();
  const domainGroups = new Map<
    string,
    { minutes: number; evidenceIds: string[] }
  >();
  const add = (
    groups: Map<string, { minutes: number; evidenceIds: string[] }>,
    key: string,
    minutes: number,
    id: string,
  ) => {
    const group = groups.get(key) ?? { minutes: 0, evidenceIds: [] };
    group.minutes += minutes;
    group.evidenceIds.push(id);
    groups.set(key, group);
  };
  let uniqueTotalMinutes = 0;
  const sessions = rawSessions.map((entity) => {
    const { materialId } = relationIds(entity);
    const goalIds = [
      ...new Set(
        entity.relations
          .filter((r) => r.type === "supports")
          .map((r) => r.target),
      ),
    ];
    const minutes = entity.fields.minutes;
    const counted =
      entity.kind === "fact" &&
      entity.status === "done" &&
      typeof minutes === "number" &&
      Number.isFinite(minutes) &&
      minutes > 0;
    if (entity.kind === "fact" && entity.status === "done" && !counted)
      issue(entity, "invalid-minutes", "阅读分钟必须为正有限数值");
    const targets = goalIds
      .map((id) => lookup.get(id))
      .filter((target): target is Entity => {
        if (
          !target ||
          target.kind !== "plan" ||
          !["goal", "direction", "language-goal"].includes(target.type)
        ) {
          issue(entity, "goal-link", "目标关系缺失或类型不符");
          return false;
        }
        return true;
      });
    if (counted) {
      uniqueTotalMinutes += minutes;
      const language = String(
        entity.fields.language ??
          (materialId ? lookup.get(materialId)?.fields.language : "") ??
          "",
      );
      const languageCode = normalizeLanguage(language);
      if (!languageCode)
        issue(entity, "missing-language", "阅读语言缺失或不受支持");
      add(
        languageGroups,
        languageCode ?? (language || "未注明"),
        minutes,
        entity.id,
      );
      for (const target of targets) {
        const group = goalGroups.get(target.id) ?? {
          goalId: target.id,
          title: target.title,
          module: target.module,
          minutes: 0,
          evidenceIds: [],
        };
        group.minutes += minutes;
        group.evidenceIds.push(entity.id);
        goalGroups.set(target.id, group);
      }
      for (const domain of new Set([
        "learning",
        ...targets.map((target) => target.module),
      ]))
        add(domainGroups, domain, minutes, entity.id);
    }
    return { entity, materialId, goalIds, counted };
  });
  const explanations = rawExplanations.map((entity) => {
    if (entity.kind !== "inference" || entity.status !== "draft")
      issue(entity, "explanation-kind", "辅助解释应独立保存为待核对推断");
    return { entity, ...relationIds(entity) };
  });
  const vocabulary = rawVocabulary.map((entity) => {
    const links = relationIds(entity);
    if (!links.sessionId) issue(entity, "session-link", "词汇缺少阅读记录关系");
    return { entity, ...links };
  });
  const languageLabels = languageDisplayLabels(
    [...languageGroups.keys()],
    catalog,
  );
  return {
    uniqueTotalMinutes,
    byLanguage: [...languageGroups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([language, group]) => ({
        language: languageLabels.get(language)!,
        ...group,
      })),
    byLanguageCode: [...languageGroups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, group]) => ({
        code,
        language: languageLabel(code, catalog),
        ...group,
      })),
    byGoal: [...goalGroups.values()].sort((a, b) =>
      a.goalId.localeCompare(b.goalId),
    ),
    byDomain: [...domainGroups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([domain, group]) => ({ domain, ...group })),
    materials: rawMaterials.map((entity) => ({
      entity,
      sessionIds: sessions
        .filter((s) => s.materialId === entity.id)
        .map((s) => s.entity.id),
      explanationIds: explanations
        .filter((e) => e.materialId === entity.id)
        .map((e) => e.entity.id),
      vocabularyIds: vocabulary
        .filter((v) => v.materialId === entity.id)
        .map((v) => v.entity.id),
    })),
    sessions,
    explanations,
    vocabulary,
    issues,
    viewTotalsAdditive: false,
    countingPolicy:
      "仅已完成事实阅读记录按唯一实体计时；同次阅读可支持多个目标。目标与领域是覆盖视角，彼此及各视角总数不可相加；解释和词汇不另记分钟。",
  };
}
