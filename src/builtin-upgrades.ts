import { builtins, legacyBuiltins } from "./modules.js";
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
