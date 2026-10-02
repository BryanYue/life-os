import type { Module } from "./types.js";

export const CORE_VERSION = "0.1.0";
export type ModulePermission = {
  id: string;
  action: "read" | "suggest" | "write" | "external";
  module: string;
  entityTypes?: string[];
  fields?: string[];
};
export type ModuleOperation = {
  id: string;
  permissions: string[];
  handler: "list" | "suggest" | "write" | "patch" | "external" | "stdio";
};
export type ModuleContract = {
  protocol: 1;
  core: { api: 1; minVersion: string; maxVersionExclusive?: string };
  permissions: ModulePermission[];
  operations: ModuleOperation[];
  importers: { id: string; operation: string; format: "json" | "text" }[];
  dependencies: {
    module: string;
    minVersion: string;
    maxVersionExclusive?: string;
  }[];
  migrations?: {
    fromSchema: number;
    toSchema: number;
    renames: Record<string, string>;
  }[];
};
const key = /^[a-z][a-z0-9-]{0,60}$/;
const moduleKey = /^([a-z][a-z0-9-]*\.)*[a-z][a-z0-9-]{1,40}$/;
const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function compareVersions(a: string, b: string): number {
  if (!version.test(a) || !version.test(b))
    throw Error("Invalid contract version");
  const left = a.split(".").map(Number),
    right = b.split(".").map(Number);
  if ([...left, ...right].some((x) => !Number.isSafeInteger(x)))
    throw Error("Invalid contract version");
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  return 0;
}
export function compatibleVersion(current: string, min: string, max?: string) {
  return (
    compareVersions(current, min) >= 0 &&
    (!max || compareVersions(current, max) < 0)
  );
}
function range(min: string, max?: string) {
  compareVersions(min, min);
  if (max !== undefined && compareVersions(max, min) <= 0)
    throw Error("Invalid contract version range");
}
function unique(values: string[], pattern: RegExp) {
  if (
    !Array.isArray(values) ||
    values.some((x) => typeof x !== "string" || !pattern.test(x)) ||
    new Set(values).size !== values.length
  )
    throw Error("Invalid or duplicate contract keys");
}
export function validateContract(
  module: Module & { contract?: ModuleContract },
) {
  const c = module.contract;
  // Existing declarative modules remain valid; an executable manifest requires a contract.
  if (c === undefined) return;
  if (
    !c ||
    c.protocol !== 1 ||
    !c.core ||
    c.core.api !== module.coreApi ||
    !Array.isArray(c.permissions) ||
    !Array.isArray(c.operations) ||
    !Array.isArray(c.importers) ||
    !Array.isArray(c.dependencies)
  )
    throw Error("Invalid module contract");
  range(c.core.minVersion, c.core.maxVersionExclusive);
  if (
    !compatibleVersion(
      CORE_VERSION,
      c.core.minVersion,
      c.core.maxVersionExclusive,
    )
  )
    throw Error("Incompatible core version");
  unique(
    c.permissions.map((p) => p?.id),
    key,
  );
  unique(
    c.operations.map((o) => o?.id),
    key,
  );
  unique(
    c.importers.map((i) => i?.id),
    key,
  );
  unique(
    c.dependencies.map((d) => d?.module),
    moduleKey,
  );
  for (const d of c.dependencies) {
    if (d.module === module.id) throw Error("Self dependency rejected");
    range(d.minVersion, d.maxVersionExclusive);
  }
  for (const p of c.permissions) {
    if (
      !["read", "suggest", "write", "external"].includes(p.action) ||
      !moduleKey.test(p.module)
    )
      throw Error("Invalid contract permission");
    if (
      p.module !== module.id &&
      !c.dependencies.some((d) => d.module === p.module)
    )
      throw Error("Cross module permission requires declared dependency");
    if (p.entityTypes !== undefined) {
      unique(p.entityTypes, key);
      if (!p.entityTypes.length) throw Error("Empty entity type scope");
    }
    if (p.fields !== undefined) unique(p.fields, /^[a-z][a-zA-Z0-9]*$/);
    if (p.module === module.id) validatePermissionSchema(p, module);
  }
  for (const o of c.operations) {
    unique(o.permissions, key);
    if (
      !o.permissions.length ||
      o.permissions.some((id) => !c.permissions.some((p) => p.id === id)) ||
      !["list", "suggest", "write", "patch", "external", "stdio"].includes(
        o.handler,
      )
    )
      throw Error("Invalid operation permission or handler");
    const action =
      o.handler === "list"
        ? "read"
        : o.handler === "patch"
          ? "write"
          : o.handler;
    if (
      action !== "stdio" &&
      !o.permissions.some(
        (id) => c.permissions.find((p) => p.id === id)?.action === action,
      )
    )
      throw Error("Operation handler lacks matching permission");
  }
  for (const i of c.importers) {
    const op = c.operations.find((o) => o.id === i.operation);
    if (
      !["json", "text"].includes(i.format) ||
      !op ||
      !op.permissions.some((id) =>
        ["suggest", "write"].includes(
          c.permissions.find((p) => p.id === id)!.action,
        ),
      )
    )
      throw Error("Invalid importer operation");
  }
  if (c.migrations !== undefined) {
    if (!Array.isArray(c.migrations))
      throw Error("Invalid contract migrations");
    const seen = new Set<number>();
    for (const m of c.migrations) {
      if (
        !m ||
        !Number.isSafeInteger(m.fromSchema) ||
        m.fromSchema < 1 ||
        m.toSchema !== m.fromSchema + 1 ||
        m.toSchema > module.schemaVersion ||
        seen.has(m.fromSchema) ||
        !m.renames ||
        typeof m.renames !== "object" ||
        Array.isArray(m.renames)
      )
        throw Error("Invalid contract migration");
      seen.add(m.fromSchema);
      unique(Object.keys(m.renames), /^[a-z][a-zA-Z0-9]*$/);
      unique(Object.values(m.renames), /^[a-z][a-zA-Z0-9]*$/);
      const available = new Set(
        module.entityTypes.flatMap((t) => t.fields.map((f) => f.key)),
      );
      if (Object.values(m.renames).some((f) => !available.has(f)))
        throw Error("Unknown migration target field");
    }
  }
}
export function validatePermissionSchema(
  permission: ModulePermission,
  module: Module,
) {
  const types = module.entityTypes.filter(
    (t) => !permission.entityTypes || permission.entityTypes.includes(t.id),
  );
  if (
    permission.entityTypes?.some(
      (id) => !module.entityTypes.some((t) => t.id === id),
    )
  )
    throw Error("Unknown permission entity type");
  if (
    permission.fields?.some(
      (id) => !types.some((t) => t.fields.some((f) => f.key === id)),
    )
  )
    throw Error("Unknown permission field");
}
