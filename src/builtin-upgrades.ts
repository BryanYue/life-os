import { builtins, legacyBuiltins, withLanguageCodes } from "./modules.js";
import type { Module } from "./types.js";
import type { Store } from "./store.js";
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, canonical(x)]),
        )
      : v;
const structure = (module: Module) =>
  JSON.stringify(
    canonical({ ...module, enabled: undefined, codeVisibility: undefined }),
  );
const ids = ["learning", "languages"];
export function pendingBuiltinUpgrades(store: Store) {
  return {
    pending: ids.flatMap((id) => {
      const current = store.module(id, false),
        target = builtins.find((m) => m.id === id)!,
        legacy = legacyBuiltins.find((m) => m.id === id)!;
      if (current.schemaVersion >= target.schemaVersion) return [];
      const compatible = structure(current) === structure(legacy);
      return [
        {
          module: id,
          name: target.name,
          fromVersion: current.version,
          toVersion: target.version,
          fromSchema: current.schemaVersion,
          toSchema: target.schemaVersion,
          compatible,
          ...(!compatible
            ? {
                reason:
                  "本地模块结构与已知旧版不同；需保留自定义字段并准备专门迁移。",
              }
            : {}),
        },
      ];
    }),
  };
}
export function upgradeBuiltin(store: Store, id: string) {
  if (!ids.includes(id)) throw Error("Unsupported builtin upgrade");
  const current = store.module(id, false),
    target = builtins.find((m) => m.id === id)!;
  if (
    current.schemaVersion === target.schemaVersion &&
    structure(current) === structure(target)
  )
    return {
      module: id,
      fromSchema: current.schemaVersion,
      toSchema: target.schemaVersion,
      alreadyCurrent: true,
    };
  const pending = pendingBuiltinUpgrades(store).pending.find(
    (p) => p.module === id,
  );
  if (!pending?.compatible)
    throw Error(
      "Custom or newer module requires a reviewed local migration; no records changed",
    );
  const next = {
    ...structuredClone(target),
    enabled: current.enabled,
    codeVisibility: current.codeVisibility,
  };
  const result = store.migrateModule(next);
  return {
    module: id,
    fromSchema: current.schemaVersion,
    toSchema: target.schemaVersion,
    backup: result.backup,
    alreadyCurrent: false,
  };
}

export function pendingBuiltinLanguageUpgrades(store: Store) {
  return {
    pending: ids.flatMap((id) => {
      const current = store.module(id, false);
      if (current.schemaVersion >= 3) return [];
      return [
        {
          module: id,
          name: current.name,
          fromSchema: current.schemaVersion,
          toSchema: 3,
          compatible: current.schemaVersion === 2,
          ...(current.schemaVersion !== 2
            ? { reason: "请先显式完成内置 schema 1 到 2 升级。" }
            : {}),
        },
      ];
    }),
  };
}

/** Widen a manifest in place; custom fields, names and settings remain owned
 * by the installation, and Store records a recoverable migration backup. */
export function upgradeBuiltinLanguages(store: Store, id: string) {
  if (!ids.includes(id)) throw Error("Unsupported builtin language upgrade");
  const current = store.module(id, false);
  if (
    current.schemaVersion === 3 &&
    current.entityTypes.every((type) =>
      type.fields.every(
        (field) => field.key !== "language" || field.type !== "select",
      ),
    )
  )
    return { module: id, fromSchema: 3, toSchema: 3, alreadyCurrent: true };
  const next = withLanguageCodes(current);
  const result = store.migrateModule(next);
  return {
    module: id,
    fromSchema: current.schemaVersion,
    toSchema: next.schemaVersion,
    backup: result.backup,
    alreadyCurrent: false,
  };
}
