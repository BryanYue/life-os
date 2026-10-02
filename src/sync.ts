import { randomUUID } from "node:crypto";
import type { Store } from "./store.js";
import type {
  Entity,
  Module,
  Operation,
  Snapshot,
  SyncBootstrap,
  SyncProjection,
  SyncScope,
} from "./types.js";
import { validateModule } from "./modules.js";
import {
  assertFullSnapshotScope,
  normalizedScope,
  projectEntity,
  syncEntityAllowed,
} from "./permissions.js";
import { hash } from "./vault.js";
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
const digest = (v: unknown) => hash(JSON.stringify(canonical(v)));
const signed = <T extends object>(payload: T) => ({
  ...payload,
  sha256: digest(payload),
});
const id = (v: unknown) =>
  typeof v === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(v);
function checkEnvelope(
  packet: SyncBootstrap | SyncProjection,
  mode: "bootstrap" | "projection",
) {
  if (
    !packet ||
    packet.protocol !== 2 ||
    packet.mode !== mode ||
    !id(packet.batchId) ||
    !id(packet.device) ||
    !Number.isSafeInteger(packet.cursor) ||
    packet.cursor < 0 ||
    !Array.isArray(packet.records) ||
    packet.records.length > 20000
  )
    throw Error("Invalid sync baseline envelope");
  const { sha256, ...payload } = packet;
  if (digest(payload) !== sha256)
    throw Error("Sync baseline checksum mismatch");
  normalizedScope(packet.scope);
}
const cursor = (s: Store) =>
  Number(
    s.db.prepare("SELECT COALESCE(MAX(seq),0) AS n FROM operations").get()!.n,
  );
function allowedRecords(s: Store, scope: SyncScope) {
  return s
    .list({ includeDeleted: true })
    .filter((e) => syncEntityAllowed(e, scope));
}
function completeRelations(records: Snapshot[], scope: SyncScope) {
  const byId = new Map(records.map((r) => [r.id, r]));
  for (const record of records) {
    assertFullSnapshotScope(record, scope);
    for (const rel of record.relations) {
      const target = byId.get(rel.target);
      if (!target || !syncEntityAllowed(target, scope))
        throw Error(
          "Sync baseline requires authorized relation targets in the selection",
        );
    }
  }
}
/** Current schemas and records initialize an empty selection without replaying obsolete schemas. */
export function exportBootstrap(
  s: Store,
  grant: string[] | SyncScope,
): SyncBootstrap {
  s.captureExternalNotes();
  const scope = normalizedScope(grant);
  return s.transaction(() => {
    const records = allowedRecords(s, scope).map((e) => s.snapshot(e.id)!);
    completeRelations(records, scope);
    const ids = new Set(records.map((e) => e.id));
    const modules = s
      .modules()
      .filter(
        (m) =>
          scope.modules.includes(m.id) &&
          m.id !== "family" &&
          (!scope.entities || scope.entities[m.id]),
      );
    const seenById = new Map<string, SyncBootstrap["seen"][number]>();
    for (const row of s.db
      .prepare("SELECT key,value FROM meta WHERE key LIKE 'sync-seen:%'")
      .all()) {
      const receipt = JSON.parse(String(row.value)) as {
        entityId: string;
        digest: string;
      };
      if (ids.has(receipt.entityId))
        seenById.set(String(row.key).slice("sync-seen:".length), {
          id: String(row.key).slice("sync-seen:".length),
          ...receipt,
        });
    }
    for (const row of s.db
      .prepare("SELECT json FROM operations ORDER BY seq")
      .all()) {
      const op = JSON.parse(String(row.json)) as Operation;
      if (ids.has(op.entityId)) {
        const receipt = {
            id: op.id,
            entityId: op.entityId,
            digest: digest(op),
          },
          known = seenById.get(op.id);
        if (known && known.digest !== receipt.digest)
          throw Error("Conflicting stored sync receipt");
        seenById.set(op.id, receipt);
      }
    }
    const seen = [...seenById.values()];
    const sourceReceipts = s.db
      .prepare("SELECT * FROM source_receipts")
      .all()
      .filter((row) =>
        ids.has(String(row.entity)),
      ) as SyncBootstrap["sourceReceipts"];
    const imports = s.db
      .prepare("SELECT * FROM imports")
      .all()
      .filter((row) => ids.has(String(row.entity))) as SyncBootstrap["imports"];
    return signed({
      protocol: 2 as const,
      mode: "bootstrap" as const,
      batchId: randomUUID(),
      device: s.device,
      cursor: cursor(s),
      scope,
      modules,
      records,
      seen,
      sourceReceipts,
      imports,
    });
  });
}
export function importBootstrap(
  s: Store,
  packet: SyncBootstrap,
  grant: string[] | SyncScope,
  options: { acceptManifests?: boolean } = {},
) {
  checkEnvelope(packet, "bootstrap");
  const scope = normalizedScope(grant);
  if (
    !Array.isArray(packet.modules) ||
    !Array.isArray(packet.seen) ||
    packet.seen.length > 200000 ||
    !Array.isArray(packet.sourceReceipts) ||
    !Array.isArray(packet.imports)
  )
    throw Error("Invalid sync baseline contents");
  completeRelations(packet.records, scope);
  const receiptKey = "sync-bootstrap:" + packet.batchId;
  const prior = s.db
    .prepare("SELECT value FROM meta WHERE key=?")
    .get(receiptKey);
  if (prior) {
    if (prior.value !== packet.sha256) throw Error("Baseline ID reused");
    return { applied: 0, cursor: packet.cursor, mode: "local simulation only" };
  }
  s.captureExternalNotes();
  completeRelations(packet.records, scope);
  const ids = new Set(packet.records.map((e) => e.id));
  if (
    ids.size !== packet.records.length ||
    packet.records.some((e) => !id(e.id))
  )
    throw Error("Invalid baseline record identities");
  if (packet.records.some((e) => s.vault.read(e.id) && !s.raw(e.id)))
    throw Error("Baseline cannot claim an existing orphan Markdown note");
  if (packet.records.some((e) => s.raw(e.id)))
    throw Error(
      "Baseline only initializes missing records; existing data is preserved",
    );
  const incoming = new Map(packet.records.map((e) => [e.id, e]));
  const modules = new Map<string, Module>();
  for (const m of packet.modules) {
    validateModule(m);
    if (modules.has(m.id) || !scope.modules.includes(m.id) || m.id === "family")
      throw Error("Baseline module permission rejected");
    modules.set(m.id, m);
  }
  for (const e of packet.records)
    if (!modules.has(e.module)) throw Error("Missing baseline module manifest");
  for (const seen of packet.seen)
    if (
      !id(seen.id) ||
      !ids.has(seen.entityId) ||
      !/^[a-f0-9]{64}$/.test(seen.digest)
    )
      throw Error("Invalid baseline operation receipt");
  for (const row of [...packet.sourceReceipts, ...packet.imports]) {
    if (
      !row ||
      !ids.has(row.entity) ||
      [row.namespace, row.source_id, row.revision].some(
        (v) => typeof v !== "string" || !v,
      ) ||
      !/^(v2:)?[a-f0-9]{64}$/.test(row.digest)
    )
      throw Error("Invalid baseline source receipt");
  }
  const comparable = (m: Module) => ({
    ...m,
    enabled: undefined,
    codeVisibility: undefined,
  });
  return s.transaction(() => {
    for (const m of modules.values()) {
      const current = s.modules().find((x) => x.id === m.id);
      if (current && digest(comparable(current)) === digest(comparable(m)))
        continue;
      if (!options.acceptManifests)
        throw Error(
          "Explicit manifest acceptance required for a new or changed schema",
        );
      if (
        current &&
        s.db.prepare("SELECT 1 FROM entities WHERE module=?").get(m.id)
      )
        throw Error(
          "Existing module data requires a local migration; baseline cannot replace its schema",
        );
      s.db
        .prepare("INSERT OR REPLACE INTO modules VALUES(?,?)")
        .run(
          m.id,
          JSON.stringify({ ...m, enabled: m.contract ? false : m.enabled }),
        );
    }
    for (const record of packet.records)
      s.validate(
        record,
        (target) => incoming.get(target) ?? s.snapshot(target),
        true,
      );
    // Queue all snapshots before projecting notes, so references do not depend on array order.
    for (const record of packet.records) {
      const seq = cursor(s) + 1;
      s.writeSnapshot(
        record,
        {
          id: hash("baseline:" + packet.batchId + ":" + record.id),
          device: s.device,
          sequence: seq,
          entityId: record.id,
          base: record,
          value: record,
          at: new Date().toISOString(),
        },
        "sync",
        "bootstrap",
      );
    }
    for (const seen of packet.seen) {
      const key = "sync-seen:" + seen.id,
        old = s.db.prepare("SELECT value FROM meta WHERE key=?").get(key);
      const value = JSON.stringify({
        entityId: seen.entityId,
        digest: seen.digest,
      });
      if (old && old.value !== value)
        throw Error("Conflicting baseline operation receipt");
      s.db.prepare("INSERT OR REPLACE INTO meta VALUES(?,?)").run(key, value);
    }
    for (const [table, rows] of [
      ["source_receipts", packet.sourceReceipts],
      ["imports", packet.imports],
    ] as const)
      for (const row of rows) {
        const old = s.db
          .prepare(
            "SELECT entity FROM " +
              table +
              " WHERE namespace=? AND source_id=?",
          )
          .get(row.namespace, row.source_id);
        if (old && old.entity !== row.entity)
          throw Error("Source identity already belongs to another record");
        s.db
          .prepare("INSERT OR REPLACE INTO " + table + " VALUES(?,?,?,?,?)")
          .run(
            row.namespace,
            row.source_id,
            row.revision,
            ...(table === "imports"
              ? [row.entity, row.digest]
              : [row.digest, row.entity]),
          );
      }
    const saved = Number(
      s.db.prepare("SELECT seq FROM cursors WHERE device=?").get(packet.device)
        ?.seq ?? 0,
    );
    s.db
      .prepare("INSERT OR REPLACE INTO cursors VALUES(?,?)")
      .run(packet.device, Math.max(saved, packet.cursor));
    s.db.prepare("INSERT INTO meta VALUES(?,?)").run(receiptKey, packet.sha256);
    return {
      applied: packet.records.length,
      cursor: packet.cursor,
      mode: "local simulation only",
    };
  });
}
/** Field-selected sharing is explicitly read-only; it never erases private fields of an editable record. */
export function exportProjection(s: Store, grant: SyncScope): SyncProjection {
  s.captureExternalNotes();
  const scope = normalizedScope(grant),
    records = allowedRecords(s, scope),
    ids = new Set(records.map((e) => e.id));
  return signed({
    protocol: 2 as const,
    mode: "projection" as const,
    batchId: randomUUID(),
    device: s.device,
    cursor: cursor(s),
    scope,
    records: records.map((e) =>
      projectEntity(e, scope.entities?.[e.module], (target) => ids.has(target)),
    ),
  });
}
export function importProjection(
  s: Store,
  packet: SyncProjection,
  grant: SyncScope,
) {
  checkEnvelope(packet, "projection");
  const scope = normalizedScope(grant);
  validateProjectionRecords(packet.records, scope);
  const channel =
      "sync-projection:" + packet.device + ":" + digest(packet.scope),
    oldRow = s.db.prepare("SELECT value FROM meta WHERE key=?").get(channel);
  const old = oldRow
    ? (JSON.parse(String(oldRow.value)) as {
        cursor: number;
        records: Entity[];
      })
    : null;
  if (old && packet.cursor < old.cursor)
    return { applied: 0, stale: true, readOnly: true };
  if (old && packet.cursor === old.cursor) {
    if (digest(old.records) !== digest(packet.records))
      throw Error("Projection changed without a new cursor");
    return { applied: 0, readOnly: true };
  }
  s.db.prepare("INSERT OR REPLACE INTO meta VALUES(?,?)").run(
    channel,
    JSON.stringify({
      device: packet.device,
      cursor: packet.cursor,
      scope: packet.scope,
      records: packet.records,
    }),
  );
  return { applied: packet.records.length, readOnly: true };
}
function validateProjectionRecords(records: Entity[], scope: SyncScope) {
  if (!Array.isArray(records) || records.length > 20000)
    throw Error("Invalid projection records");
  const ids = new Set(records.map((e) => e?.id));
  if (ids.size !== records.length) throw Error("Duplicate projection identity");
  const keys = [
    "id",
    "module",
    "type",
    "title",
    "kind",
    "status",
    "occurredAt",
    "timeZone",
    "createdAt",
    "updatedAt",
    "actor",
    "version",
    "schemaVersion",
    "source",
    "fields",
    "relations",
    "body",
    "noteHash",
    "deleted",
  ];
  for (const e of records) {
    if (
      !e ||
      Object.keys(e).length !== keys.length ||
      keys.some((key) => !(key in e)) ||
      !id(e.id) ||
      typeof e.module !== "string" ||
      !/^([a-z][a-z0-9-]*\.)*[a-z][a-z0-9-]{1,40}$/.test(e.module) ||
      !id(e.type) ||
      !syncEntityAllowed(e, scope) ||
      !["plan", "fact", "inference"].includes(e.kind) ||
      !["draft", "active", "done", "failed"].includes(e.status) ||
      [e.title, e.actor, e.timeZone].some((v) => typeof v !== "string") ||
      [e.createdAt, e.updatedAt, e.occurredAt].some(
        (v) =>
          typeof v !== "string" ||
          (v !== "" && !Number.isFinite(Date.parse(v))),
      ) ||
      !Number.isSafeInteger(e.version) ||
      e.version < 1 ||
      !Number.isSafeInteger(e.schemaVersion) ||
      e.schemaVersion < 1 ||
      !e.source ||
      Object.keys(e.source).length !== 4 ||
      [e.source.namespace, e.source.recordId, e.source.revision].some(
        (v) => typeof v !== "string" || !v,
      ) ||
      !["manual", "import", "device", "rule"].includes(e.source.mode) ||
      !e.fields ||
      typeof e.fields !== "object" ||
      Array.isArray(e.fields) ||
      Object.values(e.fields).some(
        (v) =>
          typeof v !== "string" &&
          !(typeof v === "number" && Number.isFinite(v)),
      ) ||
      !Array.isArray(e.relations) ||
      e.relations.some(
        (r) =>
          !r ||
          Object.keys(r).length !== 2 ||
          !id(r.type) ||
          !id(r.target) ||
          !ids.has(r.target),
      ) ||
      typeof e.body !== "string" ||
      typeof e.noteHash !== "string" ||
      (e.noteHash !== "" && !/^[a-f0-9]{64}$/.test(e.noteHash)) ||
      typeof e.deleted !== "boolean"
    )
      throw Error("Invalid or unauthorized projection");
    if (e.timeZone) new Intl.DateTimeFormat("en", { timeZone: e.timeZone });
    if (
      digest(
        projectEntity(e, scope.entities?.[e.module], (target) =>
          ids.has(target),
        ),
      ) !== digest(e)
    )
      throw Error("Projection contains fields outside receiver authorization");
  }
}
/** Restores validate retained protocol state before publishing the new directory. */
export function validateSyncMetadata(
  key: string,
  value: string,
  entityIds: Set<string>,
) {
  if (key.startsWith("sync-seen:")) {
    const receipt = JSON.parse(value);
    if (
      !id(key.slice("sync-seen:".length)) ||
      !receipt ||
      Object.keys(receipt).length !== 2 ||
      !entityIds.has(receipt.entityId) ||
      !/^[a-f0-9]{64}$/.test(receipt.digest)
    )
      throw Error("Invalid backup sync receipt");
  } else if (key.startsWith("sync-bootstrap:")) {
    if (
      !id(key.slice("sync-bootstrap:".length)) ||
      !/^[a-f0-9]{64}$/.test(value)
    )
      throw Error("Invalid backup baseline receipt");
  } else if (key.startsWith("sync-projection:")) {
    const projection = JSON.parse(value);
    if (
      !projection ||
      Object.keys(projection).length !== 4 ||
      !id(projection.device) ||
      !Number.isSafeInteger(projection.cursor) ||
      projection.cursor < 0
    )
      throw Error("Invalid backup projection state");
    const scope = normalizedScope(projection.scope);
    if (key !== "sync-projection:" + projection.device + ":" + digest(scope))
      throw Error("Invalid backup projection identity");
    validateProjectionRecords(projection.records, scope);
  }
}
export function listProjections(s: Store) {
  return s.db
    .prepare("SELECT value FROM meta WHERE key LIKE 'sync-projection:%'")
    .all()
    .map((r) => ({ ...JSON.parse(String(r.value)), readOnly: true }));
}
