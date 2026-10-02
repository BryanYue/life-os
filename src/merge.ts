import { merge } from "node-diff3";
import type { Snapshot } from "./types.js";
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function mergeSnapshots(
  base: Snapshot | null,
  local: Snapshot | null,
  remote: Snapshot,
): Snapshot | null {
  if (!local) return base ? null : remote;
  if (!base) return same(local, remote) ? local : null;
  // Classification cannot be changed by remote reconciliation.
  if (
    ["kind", "module", "type"].some(
      (k) =>
        (local as any)[k] !== (base as any)[k] ||
        (remote as any)[k] !== (base as any)[k],
    )
  )
    return null;
  if (local.deleted !== base.deleted || remote.deleted !== base.deleted) {
    const clean = (x: Snapshot) => ({
      ...x,
      version: 0,
      updatedAt: "",
      actor: "",
    });
    if (same(clean(local), clean(base))) return remote;
    if (same(clean(remote), clean(base))) return local;
    return same(clean(local), clean(remote)) ? local : null;
  }
  const result = structuredClone(remote);
  const scalar = [
    "title",
    "status",
    "occurredAt",
    "timeZone",
    "source",
    "relations",
    "module",
    "type",
    "schemaVersion",
  ] as const;
  for (const k of scalar) {
    if (same(local[k], remote[k]) || same(local[k], base[k])) continue;
    if (same(remote[k], base[k])) (result as any)[k] = local[k];
    else return null;
  }
  result.fields = {};
  for (const key of new Set([
    ...Object.keys(base.fields),
    ...Object.keys(local.fields),
    ...Object.keys(remote.fields),
  ])) {
    const b = base.fields[key],
      l = local.fields[key],
      r = remote.fields[key];
    const v = same(l, r) || same(l, b) ? r : same(r, b) ? l : undefined;
    if (v === undefined && l !== undefined && r !== undefined) return null;
    if (v !== undefined) result.fields[key] = v;
    else if (!same(l, b) && !same(r, b) && !same(l, r)) return null;
  }
  const merged = merge(
    local.markdown.split("\n"),
    base.markdown.split("\n"),
    remote.markdown.split("\n"),
  );
  if (merged.conflict) return null;
  result.markdown = merged.result.join("\n");
  return result;
}
