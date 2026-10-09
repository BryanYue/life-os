import type {
  Capability,
  Entity,
  EntityInput,
  EntityScope,
  Snapshot,
  SyncScope,
} from "./types.js";

export function normalizedScope(scope: string[] | SyncScope): SyncScope {
  const value = Array.isArray(scope) ? { modules: scope } : scope;
  if (
    !value ||
    !Array.isArray(value.modules) ||
    value.modules.some((m) => typeof m !== "string") ||
    (value.entities &&
      (typeof value.entities !== "object" || Array.isArray(value.entities)))
  )
    throw Error("Invalid permission scope");
  for (const [module, selection] of Object.entries(value.entities ?? {})) {
    if (!value.modules.includes(module))
      throw Error("Scope module is not granted");
    validateEntityScope(selection);
  }
  return value;
}
export function validateEntityScope(s: EntityScope) {
  if (!s || typeof s !== "object" || Array.isArray(s))
    throw Error("Invalid entity scope");
  if (
    Object.keys(s).some(
      (key) =>
        ![
          "entityIds",
          "entityTypes",
          "fields",
          "metadata",
          "body",
          "relations",
        ].includes(key),
    )
  )
    throw Error("Unknown entity scope selection");
  for (const field of [
    "entityIds",
    "entityTypes",
    "fields",
    "metadata",
  ] as const)
    if (
      s[field] !== undefined &&
      (!Array.isArray(s[field]) || s[field]!.some((v) => typeof v !== "string"))
    )
      throw Error("Invalid scope selection");
  if (
    s.metadata?.some(
      (key) =>
        ![
          "title",
          "source",
          "actor",
          "createdAt",
          "updatedAt",
          "occurredAt",
          "timeZone",
        ].includes(key),
    )
  )
    throw Error("Invalid metadata selection");
  for (const field of ["body", "relations"] as const)
    if (s[field] !== undefined && typeof s[field] !== "boolean")
      throw Error("Invalid scope flag");
}
export function entityAllowed(
  e: Pick<EntityInput, "module" | "type" | "id">,
  scope?: Record<string, EntityScope>,
) {
  if (!scope) return true;
  const s = scope[e.module];
  if (!s) return false;
  validateEntityScope(s);
  return (
    (!s.entityIds || (!!e.id && s.entityIds.includes(e.id))) &&
    (!s.entityTypes || s.entityTypes.includes(e.type))
  );
}
export function isProjection(s?: EntityScope) {
  return (
    !!s &&
    (s.fields !== undefined ||
      s.metadata !== undefined ||
      s.body === false ||
      s.relations === false)
  );
}
export function projectEntity(
  e: Entity,
  s?: EntityScope,
  relationVisible: (id: string) => boolean = () => true,
): Entity {
  if (!isProjection(s))
    return {
      ...e,
      relations: e.relations.filter((r) => relationVisible(r.target)),
    };
  const out = {
    ...e,
    fields: Object.fromEntries(
      Object.entries(e.fields).filter(
        ([k]) => !s!.fields || s!.fields.includes(k),
      ),
    ),
    body: s!.body === true ? e.body : "",
    noteHash: "",
    relations:
      s!.relations === true
        ? e.relations.filter((r) => relationVisible(r.target))
        : [],
  };
  for (const k of [
    "title",
    "actor",
    "createdAt",
    "updatedAt",
    "occurredAt",
    "timeZone",
  ] as const)
    if (!(s!.metadata ?? []).includes(k)) out[k] = "";
  if (!(s!.metadata ?? []).includes("source"))
    out.source = {
      namespace: "redacted",
      recordId: "redacted",
      revision: "redacted",
      mode: "manual",
    };
  return out;
}
export function permitScopedWrite(
  input: EntityInput,
  base: Snapshot | null,
  cap: Capability,
) {
  if (!entityAllowed(input, cap.scope))
    throw Error("Permission denied: entity scope");
  const s = cap.scope?.[input.module];
  if (!isProjection(s)) return;
  if ((input.deleted ?? base?.deleted ?? false) !== (base?.deleted ?? false))
    throw Error("Permission denied: deletion requires full record access");
  if (base && input.status !== base.status)
    throw Error("Permission denied: status requires full record access");
  for (const k of new Set([
    ...Object.keys(base?.fields ?? {}),
    ...Object.keys(input.fields),
  ]))
    if (
      s!.fields &&
      !s!.fields.includes(k) &&
      input.fields[k] !== base?.fields[k]
    )
      throw Error("Permission denied: field " + k);
  if (s!.body !== true && input.body !== (base?.body ?? ""))
    throw Error("Permission denied: body");
  if (
    s!.relations !== true &&
    JSON.stringify(input.relations) !== JSON.stringify(base?.relations ?? [])
  )
    throw Error("Permission denied: relations");
  if (base)
    for (const k of ["title", "source", "occurredAt", "timeZone"] as const)
      if (
        !(s!.metadata ?? []).includes(k) &&
        JSON.stringify(input[k]) !== JSON.stringify(base[k])
      )
        throw Error("Permission denied: metadata " + k);
}
export function syncEntityAllowed(e: Snapshot | Entity, scope: SyncScope) {
  return (
    scope.modules.includes(e.module) &&
    e.module !== "family" &&
    entityAllowed(e, scope.entities)
  );
}
export function assertFullSnapshotScope(e: Snapshot, scope: SyncScope) {
  if (!syncEntityAllowed(e, scope))
    throw Error("Sync permission denied: entity scope");
  const s = scope.entities?.[e.module];
  if (isProjection(s)) {
    // A writable replica requires a complete authoritative record and note.
    // Field-selected sharing has a separate read-only projection protocol.
    throw Error("Partial field scope requires a read-only projection");
  }
}
