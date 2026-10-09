import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Store } from "./store.js";
import { hash } from "./vault.js";
import {
  HUMAN,
  type Capability,
  type Entity,
  type EntityInput,
  type Operation,
} from "./types.js";

export type TemplateScalar = string | number;
export type TemplateValue = TemplateScalar | { parameter: string };
export type TemplateParameter = {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  required?: boolean;
  default?: TemplateScalar;
  options?: string[];
  min?: number;
  max?: number;
};
export type TemplateDefinition = {
  id: string;
  version: number;
  name: string;
  description?: string;
  requires: string[];
  parameters: TemplateParameter[];
  target: {
    module: string;
    type: string;
    kind: "plan";
    status: "draft" | "active";
  };
  defaults: {
    title: TemplateValue;
    body?: TemplateValue;
    fields?: Record<string, TemplateValue>;
    relations?: { type: string; target: TemplateValue }[];
  };
};
export type TemplateListing = TemplateDefinition & {
  source: "builtin" | "personal";
  available: boolean;
  unavailableReason?: string;
};
export type TemplatePreviewInput = {
  templateId: string;
  version?: number;
  parameters?: Record<string, TemplateScalar>;
  occurredAt: string;
  timeZone: string;
};
export type TemplateApplyInput = TemplatePreviewInput & { operationId: string };
export type TemplatePreview = {
  templateId: string;
  version: number;
  entity: EntityInput;
};

const identityPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;
const keyPattern = /^[a-z][a-zA-Z0-9]*$/;
const resultFields = new Set([
  "minutes",
  "result",
  "output",
  "outcome",
  "progress",
  "takeaway",
]);
const namespace = "local-templates-v1";
const scalar = (value: unknown): value is TemplateScalar =>
  typeof value === "string" ||
  (typeof value === "number" && Number.isFinite(value));
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;
const digest = (value: unknown) => hash(JSON.stringify(canonical(value)));

// Only ordinary JSON data is accepted, including callers outside the HTTP API.
function data(value: unknown, depth = 0, seen = new Set<object>()) {
  if (depth > 20) throw Error("Template data too deeply nested");
  if (value === null || typeof value === "boolean" || scalar(value)) return;
  if (!value || typeof value !== "object" || seen.has(value))
    throw Error("Templates require declarative JSON data");
  if (
    !Array.isArray(value) &&
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw Error("Templates require plain JSON objects");
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    if (
      typeof key !== "string" ||
      ["__proto__", "prototype", "constructor"].includes(key)
    )
      throw Error("Unsafe template property");
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value"))
      throw Error("Templates cannot contain executable properties");
    data(descriptor.value, depth + 1, seen);
  }
  seen.delete(value);
}
function object(
  value: unknown,
  keys?: string[],
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Expected template object");
  if (keys && Object.keys(value).some((key) => !keys.includes(key)))
    throw Error("Unknown template property");
}
function identity(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length > 100 ||
    !identityPattern.test(value)
  )
    throw Error("Invalid template identity");
}
function text(value: unknown, limit = 300) {
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    throw Error("Invalid template text");
}
function version(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw Error("Invalid template version");
}
function parameterValue(parameter: TemplateParameter, value: unknown) {
  if (
    !scalar(value) ||
    (parameter.type === "number"
      ? typeof value !== "number"
      : typeof value !== "string")
  )
    throw Error("Invalid template parameter: " + parameter.key);
  if (typeof value === "string" && value.length > 200000)
    throw Error("Template parameter too long");
  if (parameter.required && typeof value === "string" && !value.trim())
    throw Error("Missing template parameter: " + parameter.key);
  if (
    parameter.type === "select" &&
    !parameter.options!.includes(String(value))
  )
    throw Error("Invalid template option: " + parameter.key);
  if (
    typeof value === "number" &&
    ((parameter.min !== undefined && value < parameter.min) ||
      (parameter.max !== undefined && value > parameter.max))
  )
    throw Error("Template parameter out of range: " + parameter.key);
}
function definition(input: unknown): TemplateDefinition {
  data(input);
  if (JSON.stringify(input).length > 500000) throw Error("Template too large");
  object(input, [
    "id",
    "version",
    "name",
    "description",
    "requires",
    "parameters",
    "target",
    "defaults",
  ]);
  identity(input.id);
  version(input.version);
  text(input.name);
  if (input.description !== undefined) text(input.description, 2000);
  if (
    !Array.isArray(input.requires) ||
    !input.requires.length ||
    input.requires.length > 100 ||
    new Set(input.requires).size !== input.requires.length
  )
    throw Error("Invalid template dependencies");
  input.requires.forEach(identity);
  object(input.target, ["module", "type", "kind", "status"]);
  identity(input.target.module);
  identity(input.target.type);
  if (
    input.target.kind !== "plan" ||
    !["draft", "active"].includes(String(input.target.status))
  )
    throw Error("Templates may create draft or active plans only");
  if (!input.requires.includes(input.target.module))
    throw Error("Target module must be a template dependency");
  if (!Array.isArray(input.parameters) || input.parameters.length > 100)
    throw Error("Invalid template parameters");
  const names = new Set<string>();
  for (const p of input.parameters) {
    object(p, [
      "key",
      "label",
      "type",
      "required",
      "default",
      "options",
      "min",
      "max",
    ]);
    if (
      typeof p.key !== "string" ||
      !keyPattern.test(p.key) ||
      names.has(p.key)
    )
      throw Error("Invalid or duplicate template parameter");
    names.add(p.key);
    text(p.label);
    if (
      !["text", "number", "select"].includes(String(p.type)) ||
      (p.required !== undefined && typeof p.required !== "boolean")
    )
      throw Error("Invalid template parameter definition");
    if (p.type === "select") {
      if (
        !Array.isArray(p.options) ||
        !p.options.length ||
        p.options.length > 100 ||
        new Set(p.options).size !== p.options.length
      )
        throw Error("Invalid template options");
      p.options.forEach((option) => text(option));
    } else if (p.options !== undefined)
      throw Error("Options require a select parameter");
    for (const bound of [p.min, p.max])
      if (
        bound !== undefined &&
        (p.type !== "number" ||
          typeof bound !== "number" ||
          !Number.isFinite(bound))
      )
        throw Error("Invalid template parameter bound");
    if (
      p.min !== undefined &&
      p.max !== undefined &&
      Number(p.min) > Number(p.max)
    )
      throw Error("Invalid template parameter range");
    if (p.default !== undefined)
      parameterValue(p as TemplateParameter, p.default);
  }
  const value = (v: unknown) => {
    if (scalar(v)) return;
    object(v, ["parameter"]);
    if (typeof v.parameter !== "string" || !names.has(v.parameter))
      throw Error("Unknown template parameter binding");
  };
  object(input.defaults, ["title", "body", "fields", "relations"]);
  value(input.defaults.title);
  if (input.defaults.body !== undefined) value(input.defaults.body);
  if (input.defaults.fields !== undefined) {
    object(input.defaults.fields);
    for (const [key, v] of Object.entries(input.defaults.fields)) {
      if (!keyPattern.test(key) || resultFields.has(key))
        throw Error("Template cannot prefill result or learning-minute fields");
      value(v);
    }
  }
  if (input.defaults.relations !== undefined) {
    if (
      !Array.isArray(input.defaults.relations) ||
      input.defaults.relations.length > 100
    )
      throw Error("Invalid template relations");
    for (const relation of input.defaults.relations) {
      object(relation, ["type", "target"]);
      identity(relation.type);
      value(relation.target);
    }
  }
  return structuredClone(input) as TemplateDefinition;
}

export const builtinTemplates: readonly TemplateDefinition[] = [
  {
    id: "reading.basic",
    version: 1,
    name: "阅读学习计划",
    description: "预填阅读清单；阅读完成后另行记录真实学习。",
    requires: ["learning"],
    parameters: [
      {
        key: "title",
        label: "计划标题",
        type: "text",
        required: true,
        default: "阅读学习计划",
      },
      {
        key: "focus",
        label: "关注点",
        type: "text",
        default: "理解主要观点并提出一个问题",
      },
    ],
    target: {
      module: "learning",
      type: "checklist-item",
      kind: "plan",
      status: "draft",
    },
    defaults: {
      title: { parameter: "title" },
      fields: { focus: { parameter: "focus" } },
    },
  },
  {
    id: "languages.reading",
    version: 1,
    name: "语言阅读目标",
    description: "预填语言目标；可用语言由当前语言模块校验。",
    requires: ["languages"],
    parameters: [
      {
        key: "title",
        label: "目标标题",
        type: "text",
        required: true,
        default: "语言阅读目标",
      },
      {
        key: "language",
        label: "语言",
        type: "text",
        required: true,
        default: "英语",
      },
      {
        key: "measure",
        label: "完成标准",
        type: "text",
        default: "读懂材料并用自己的话总结",
      },
    ],
    target: {
      module: "languages",
      type: "language-goal",
      kind: "plan",
      status: "draft",
    },
    defaults: {
      title: { parameter: "title" },
      fields: {
        language: { parameter: "language" },
        measure: { parameter: "measure" },
      },
    },
  },
];

export class TemplateManager {
  readonly registryPath: string;
  constructor(public store: Store) {
    this.registryPath = join(store.root, "templates.json");
  }
  private personal(): TemplateDefinition[] {
    if (!existsSync(this.registryPath)) {
      // existsSync follows links, so also reject dangling links.
      try {
        if (lstatSync(this.registryPath).isSymbolicLink())
          throw Error("Template registry symlink denied");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      return [];
    }
    if (!lstatSync(this.registryPath).isFile())
      throw Error("Template registry must be a regular file; symlink denied");
    const fd = openSync(
      this.registryPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > 2000000)
        throw Error("Invalid template registry file");
      const registry: unknown = JSON.parse(readFileSync(fd, "utf8"));
      data(registry);
      object(registry, ["format", "templates"]);
      if (
        registry.format !== 1 ||
        !Array.isArray(registry.templates) ||
        registry.templates.length > 1000
      )
        throw Error("Invalid template registry");
      const templates = registry.templates.map(definition),
        keys = new Set<string>();
      for (const t of templates) {
        const key = t.id + ":" + t.version;
        if (
          keys.has(key) ||
          builtinTemplates.some((builtin) => builtin.id === t.id)
        )
          throw Error("Duplicate or reserved template identity");
        keys.add(key);
      }
      return templates;
    } finally {
      closeSync(fd);
    }
  }
  private available(template: TemplateDefinition, cap: Capability) {
    for (const id of template.requires) {
      this.store.module(id);
      this.store.permit(cap, "read", id);
    }
    const module = this.store.module(template.target.module);
    const type = module.entityTypes.find(
      (type) => type.id === template.target.type,
    );
    if (!type) throw Error("Unknown template target type");
    for (const key of Object.keys(template.defaults.fields ?? {}))
      if (!type.fields.some((field) => field.key === key))
        throw Error("Unknown template target field: " + key);
    for (const relation of template.defaults.relations ?? [])
      if (!module.relations.some((rule) => rule.id === relation.type))
        throw Error("Unknown template relation type");
  }
  list(cap = HUMAN): TemplateListing[] {
    return [
      ...builtinTemplates.map((t) => ({ t, source: "builtin" as const })),
      ...this.personal().map((t) => ({ t, source: "personal" as const })),
    ]
      .map(({ t, source }) => {
        try {
          this.available(t, cap);
          return { ...structuredClone(t), source, available: true };
        } catch (e) {
          return {
            ...structuredClone(t),
            source,
            available: false,
            unavailableReason: (e as Error).message,
          };
        }
      })
      .sort((a, b) => a.id.localeCompare(b.id) || b.version - a.version);
  }
  register(input: TemplateDefinition, cap = HUMAN): TemplateDefinition {
    if (cap.role !== "human") throw Error("Only humans may register templates");
    const template = definition(input);
    this.available(template, cap);
    this.store.permit(cap, "write", template.target.module);
    if (builtinTemplates.some((t) => t.id === template.id))
      throw Error("Built-in template identity is reserved");
    const lock = join(this.store.root, ".templates-register.lock");
    try {
      mkdirSync(lock, { mode: 0o700 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (lstatSync(lock).isSymbolicLink())
        throw Error("Template registration lock symlink denied");
      throw Error("Template registry is busy; retry registration");
    }
    try {
      const personal = this.personal(),
        prior = personal.find(
          (t) => t.id === template.id && t.version === template.version,
        );
      if (prior) {
        if (digest(prior) !== digest(template))
          throw Error("Template version reused with different content");
        return prior;
      }
      if (
        personal.some(
          (t) => t.id === template.id && t.version >= template.version,
        )
      )
        throw Error("Template version must increase");
      if (personal.length >= 1000) throw Error("Template registry is full");
      const contents =
        JSON.stringify(
          { format: 1, templates: [...personal, template] },
          null,
          2,
        ) + "\n";
      if (Buffer.byteLength(contents) > 2000000)
        throw Error("Template registry is full");
      const temporary = mkdtempSync(join(this.store.root, ".templates-"));
      try {
        const path = join(temporary, "templates.json"),
          fd = openSync(path, "wx", 0o600);
        try {
          writeFileSync(fd, contents);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        if (
          existsSync(this.registryPath) &&
          lstatSync(this.registryPath).isSymbolicLink()
        )
          throw Error("Template registry symlink denied");
        renameSync(path, this.registryPath);
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
      return structuredClone(template);
    } finally {
      // Remove only the directory created by this registration. Existing locks
      // are never reclaimed, and an unexpected file inside it is not deleted.
      rmdirSync(lock);
    }
  }
  private input(
    input: TemplatePreviewInput | TemplateApplyInput,
    apply: boolean,
  ) {
    data(input);
    object(input, [
      "templateId",
      "version",
      "parameters",
      "occurredAt",
      "timeZone",
      ...(apply ? ["operationId"] : []),
    ]);
    identity(input.templateId);
    if (input.version !== undefined) version(input.version);
    text(input.occurredAt, 100);
    text(input.timeZone, 100);
    if (input.parameters !== undefined) {
      object(input.parameters);
      if (
        Object.keys(input.parameters).length > 100 ||
        Object.values(input.parameters).some((value) => !scalar(value))
      )
        throw Error("Invalid template parameter values");
    }
    if (
      apply &&
      (!("operationId" in input) ||
        typeof input.operationId !== "string" ||
        !/^[a-zA-Z0-9-]{1,100}$/.test(input.operationId))
    )
      throw Error("Invalid operation ID");
  }
  preview(input: TemplatePreviewInput, cap = HUMAN): TemplatePreview {
    this.input(input, false);
    const template = [...builtinTemplates, ...this.personal()]
      .filter(
        (t) =>
          t.id === input.templateId &&
          (input.version === undefined || t.version === input.version),
      )
      .sort((a, b) => b.version - a.version)[0];
    if (!template) throw Error("Unknown template or version");
    this.available(template, cap);
    const parameters: Record<string, TemplateScalar> = {};
    if (
      Object.keys(input.parameters ?? {}).some(
        (key) => !template.parameters.some((p) => p.key === key),
      )
    )
      throw Error("Unknown template parameter");
    for (const p of template.parameters) {
      const value = input.parameters?.[p.key] ?? p.default;
      if (value === undefined) {
        if (p.required) throw Error("Missing template parameter: " + p.key);
      } else {
        parameterValue(p, value);
        parameters[p.key] = value;
      }
    }
    const resolve = (
      v: TemplateValue | undefined,
    ): TemplateScalar | undefined =>
      typeof v === "object" ? parameters[v.parameter] : v;
    const title = resolve(template.defaults.title),
      body = resolve(template.defaults.body) ?? "";
    if (typeof title !== "string" || typeof body !== "string")
      throw Error("Template title and body must resolve to text");
    const fields: EntityInput["fields"] = {};
    for (const [key, v] of Object.entries(template.defaults.fields ?? {})) {
      const value = resolve(v);
      if (value !== undefined) fields[key] = value;
    }
    const relations = (template.defaults.relations ?? []).map((relation) => {
      const target = resolve(relation.target);
      if (typeof target !== "string")
        throw Error("Template relation must resolve to an entity ID");
      const entity = this.store.get(target, cap);
      if (!entity || entity.deleted)
        throw Error("Invalid template relation target");
      return { type: relation.type, target };
    });
    const entity: EntityInput = {
      ...template.target,
      title,
      body,
      fields,
      relations,
      occurredAt: input.occurredAt,
      timeZone: input.timeZone,
    };
    // A fixed validation identity never becomes an entity or a receipt.
    this.store.build(
      {
        expectedVersion: 0,
        entity: { ...entity, id: "template-preview-validation" },
      },
      cap,
    );
    return { templateId: template.id, version: template.version, entity };
  }
  apply(input: TemplateApplyInput, cap = HUMAN): Entity {
    this.input(input, true);
    const { operationId, ...request } = input,
      revision = "request-" + digest(request);
    const prior = this.store.db
      .prepare("SELECT json FROM operations WHERE id=?")
      .get(operationId);
    if (prior) {
      const operation = JSON.parse(String(prior.json)) as Operation,
        saved = operation.value;
      if (
        operation.base ||
        saved.source.namespace !== namespace ||
        saved.source.revision !== revision ||
        saved.source.mode !== "manual" ||
        !saved.source.recordId.startsWith(input.templateId + ":") ||
        saved.id !== hash("template-instance-v1:" + operationId) ||
        saved.kind !== "plan"
      )
        throw Error("Operation ID reused with different content");
      const {
        id,
        module,
        type,
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
      // Store rechecks the original receipt and current permissions, and returns
      // the current entity without reverting later edits or consulting templates.
      return this.store.saveMany(
        [
          {
            operationId,
            expectedVersion: 0,
            entity: {
              id,
              module,
              type,
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
    const preview = this.preview(request, cap),
      id = hash("template-instance-v1:" + operationId);
    return this.store.save(
      {
        operationId,
        expectedVersion: 0,
        entity: {
          ...preview.entity,
          id,
          source: {
            namespace,
            recordId: preview.templateId + ":" + preview.version,
            revision,
            mode: "manual",
          },
        },
      },
      cap,
    );
  }
}
