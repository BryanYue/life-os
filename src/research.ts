import type { Entity, EntityInput } from "./types.js";
import { Store } from "./store.js";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
export type ResearchResult = {
  format: "life-os-research-v1";
  id: string;
  revision: string;
  title: string;
  hypothesis: string;
  experimentVersion: string;
  dataset: { version: string; reference: string; entityId?: string };
  code: { reference: string };
  parameters: JsonObject;
  costs: { commissionBps: number; slippageBps: number; assumptions?: string };
  status: "not-run" | "failed" | "succeeded";
  result: JsonObject | null;
  occurredAt: string;
  timeZone: string;
  risk?: string;
  proposalId?: string;
  relations?: EntityInput["relations"];
};

function text(
  value: unknown,
  label: string,
  max = 20000,
): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw Error("Invalid research " + label);
}
function jsonValue(value: unknown, depth = 0): asserts value is Json {
  if (depth > 20) throw Error("Research JSON is too deeply nested");
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach((v) => jsonValue(v, depth + 1));
    return;
  }
  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    for (const [key, v] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key))
        throw Error("Unsafe research JSON key");
      jsonValue(v, depth + 1);
    }
    return;
  }
  throw Error("Research values must be finite JSON data");
}
function canonical(value: unknown): string {
  jsonValue(value);
  const sort = (v: Json): Json =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((key) => [key, sort(v[key])]),
          )
        : v;
  const output = JSON.stringify(sort(value));
  if (output.length > 20000) throw Error("Research JSON exceeds field limit");
  return output;
}
function object(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid research " + label);
  canonical(value);
}

export function parseResearchResult(input: ResearchResult): EntityInput {
  if (!input || input.format !== "life-os-research-v1")
    throw Error("Unsupported research format version");
  for (const key of [
    "id",
    "revision",
    "title",
    "hypothesis",
    "experimentVersion",
    "occurredAt",
    "timeZone",
  ] as const)
    text(input[key], key, key === "title" ? 300 : 20000);
  text(input.dataset?.version, "dataset version");
  text(input.dataset?.reference, "dataset reference");
  text(input.code?.reference, "code reference");
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T.*(?:Z|[+-]\d{2}:\d{2}))?$/.test(
      input.occurredAt,
    ) ||
    !Number.isFinite(Date.parse(input.occurredAt)) ||
    (input.occurredAt.length === 10 &&
      new Date(input.occurredAt).toISOString().slice(0, 10) !==
        input.occurredAt)
  )
    throw Error("Invalid research occurrence date");
  new Intl.DateTimeFormat("en", { timeZone: input.timeZone });
  object(input.parameters, "parameters");
  object(input.costs, "cost assumptions");
  if (
    input.costs.assumptions !== undefined &&
    typeof input.costs.assumptions !== "string"
  )
    throw Error("Invalid research cost assumption text");
  for (const value of [input.costs.commissionBps, input.costs.slippageBps])
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      throw Error("Invalid research commission/slippage assumptions");
  if (!["not-run", "failed", "succeeded"].includes(input.status))
    throw Error("Invalid research execution status");
  if (input.status === "not-run") {
    if (input.result !== null)
      throw Error("Unrun research cannot claim a result");
  } else {
    object(input.result, "execution result");
    if (!Object.keys(input.result!).length)
      throw Error("Executed research requires result evidence");
  }
  const relations = structuredClone(input.relations ?? []);
  if (!Array.isArray(relations)) throw Error("Invalid research relations");
  if (input.dataset.entityId) {
    text(input.dataset.entityId, "dataset entity identity");
    relations.push({ type: "evidence", target: input.dataset.entityId });
  }
  if (input.proposalId) {
    text(input.proposalId, "proposal identity");
    if (input.status === "not-run")
      throw Error("Unrun proposal cannot be an execution");
    relations.push({ type: "actual-of", target: input.proposalId });
  }
  if (input.risk !== undefined && typeof input.risk !== "string")
    throw Error("Invalid research risk");
  return {
    module: "quant",
    type: "experiment",
    title: input.title,
    kind: input.status === "not-run" ? "plan" : "fact",
    status: { "not-run": "draft", failed: "failed", succeeded: "done" }[
      input.status
    ] as EntityInput["status"],
    occurredAt: input.occurredAt,
    timeZone: input.timeZone,
    fields: {
      hypothesis: input.hypothesis,
      experimentVersion: input.experimentVersion,
      datasetVersion: input.dataset.version,
      codeRef: input.code.reference,
      parameters: canonical(input.parameters),
      costs: canonical(input.costs),
      result: input.result === null ? "" : canonical(input.result),
      risk: input.risk ?? "",
    },
    relations,
    source: {
      namespace: "manual-research-v1",
      recordId: input.id + (input.status === "not-run" ? ":proposal" : ":run"),
      revision: input.revision,
      mode: "import",
    },
    body:
      "手动导入研究记录；结果是导入数据，不证明本应用执行过回测或连接外部代码仓库。\n数据引用：" +
      input.dataset.reference +
      "\n执行状态：" +
      input.status,
  };
}

export function importResearchResult(
  store: Store,
  input: ResearchResult,
): Entity {
  const entity = parseResearchResult(input);
  if (input.dataset.entityId) {
    const dataset = store.get(input.dataset.entityId);
    if (
      !dataset ||
      dataset.deleted ||
      dataset.module !== "quant" ||
      dataset.type !== "dataset" ||
      dataset.fields.datasetVersion !== input.dataset.version ||
      dataset.fields.reference !== input.dataset.reference
    )
      throw Error("Research dataset identity/version/reference mismatch");
  }
  if (input.proposalId) {
    const proposal = store.get(input.proposalId);
    if (
      !proposal ||
      proposal.deleted ||
      proposal.module !== "quant" ||
      proposal.type !== "experiment" ||
      proposal.kind !== "plan"
    )
      throw Error("Research execution requires a valid proposal");
  }
  return store.importSource(entity);
}

function decoded(value: string | number | undefined): unknown {
  if (value === "") return null;
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
export function compareExperiments(entities: Entity[], ids: string[]) {
  if (
    !Array.isArray(ids) ||
    ids.length < 2 ||
    ids.length > 20 ||
    new Set(ids).size !== ids.length
  )
    throw Error("Select two to twenty distinct experiments");
  const rows = ids.map((id) => {
    const entity = entities.find((e) => e.id === id && !e.deleted);
    if (
      !entity ||
      !["projects", "quant"].includes(entity.module) ||
      entity.type !== "experiment"
    )
      throw Error("Experiment unavailable: " + id);
    return {
      id: entity.id,
      title: entity.title,
      module: entity.module,
      kind: entity.kind,
      status:
        entity.kind === "inference"
          ? "inference"
          : entity.kind === "plan"
            ? "not-run"
            : entity.status === "done"
              ? "succeeded"
              : entity.status === "failed"
                ? "failed"
                : "in-progress",
      experimentVersion: entity.fields.experimentVersion ?? null,
      datasetVersion: entity.fields.datasetVersion ?? null,
      codeRef: entity.fields.codeRef ?? null,
      parameters: decoded(entity.fields.parameters),
      costs: decoded(entity.fields.costs),
      result: decoded(entity.fields.result),
      evaluation: entity.fields.evaluation ?? null,
      relations: structuredClone(entity.relations),
    };
  });
  if (new Set(rows.map((r) => r.module)).size !== 1)
    throw Error("Compare experiments within one domain");
  const dimensions = [
    "status",
    "experimentVersion",
    "datasetVersion",
    "codeRef",
    "parameters",
    "costs",
    "result",
    "evaluation",
  ] as const;
  return {
    experiments: rows,
    differences: dimensions.filter(
      (key) => new Set(rows.map((r) => canonical(r[key]))).size > 1,
    ),
  };
}
