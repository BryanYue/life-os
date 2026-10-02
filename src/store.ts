import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  existsSync,
  writeFileSync,
  lstatSync,
  chmodSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { Ajv } from "ajv";
import { builtins, validateModule, fieldsSchema } from "./modules.js";
import { Vault, hash, splitNote } from "./vault.js";
import { mergeSnapshots } from "./merge.js";
import {
  HUMAN,
  type Module,
  type Entity,
  type EntityInput,
  type SaveRequest,
  type Capability,
  type Snapshot,
  type Operation,
  type SyncPacket,
  type Conflict,
} from "./types.js";
const ajv = new Ajv({ allErrors: true, strict: true });
const json = JSON.stringify;
const now = () => new Date().toISOString();
const uuid = () => randomUUID();
const validId = (id: string) =>
  typeof id === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(id);
const parse = <T>(row: { json?: unknown } | undefined): T | null =>
  row ? JSON.parse(String(row.json)) : null;
export class Store {
  db: DatabaseSync;
  vault: Vault;
  device: string;
  faultAfterCommit?: () => void;
  constructor(
    public root: string,
    options: { skipNoteRecovery?: boolean } = {},
  ) {
    root = resolve(root);
    this.root = root;
    mkdirSync(root, { recursive: true, mode: 0o700 });
    if (lstatSync(root).isSymbolicLink())
      throw Error("Data directory symlink denied");
    chmodSync(root, 0o700);
    this.vault = new Vault(join(root, "vault"));
    if (
      existsSync(join(root, "life.sqlite")) &&
      lstatSync(join(root, "life.sqlite")).isSymbolicLink()
    )
      throw Error("Database symlink denied");
    this.db = new DatabaseSync(join(root, "life.sqlite"));
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY,at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS modules(id TEXT PRIMARY KEY,json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS entities(id TEXT PRIMARY KEY,module TEXT NOT NULL,json TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS entities_module ON entities(module);
 CREATE TABLE IF NOT EXISTS edges(source TEXT NOT NULL,target TEXT NOT NULL,type TEXT NOT NULL,PRIMARY KEY(source,target,type));
 CREATE TABLE IF NOT EXISTS operations(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,entity TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,version INTEGER NOT NULL,at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS conflicts(id TEXT PRIMARY KEY,json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS cursors(device TEXT PRIMARY KEY,seq INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS pending_notes(id TEXT PRIMARY KEY,base_hash TEXT NOT NULL,markdown TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS imports(namespace TEXT NOT NULL,source_id TEXT NOT NULL,revision TEXT NOT NULL,entity TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(namespace,source_id));
 CREATE TABLE IF NOT EXISTS note_index(id TEXT PRIMARY KEY,markdown TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,digest TEXT NOT NULL,entity TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS source_receipts(namespace TEXT NOT NULL,source_id TEXT NOT NULL,revision TEXT NOT NULL,digest TEXT NOT NULL,entity TEXT NOT NULL,PRIMARY KEY(namespace,source_id,revision));
 CREATE TABLE IF NOT EXISTS module_migrations(module TEXT NOT NULL,from_version INTEGER NOT NULL,to_version INTEGER NOT NULL,at TEXT NOT NULL);
 `);
    this.db.prepare("INSERT OR IGNORE INTO migrations VALUES(1,?)").run(now());
    const device = this.db
      .prepare("SELECT value FROM meta WHERE key='device'")
      .get();
    this.device = device ? String(device.value) : uuid();
    this.db
      .prepare("INSERT OR IGNORE INTO meta VALUES('device',?)")
      .run(this.device);
    for (const m of builtins)
      this.db
        .prepare("INSERT OR IGNORE INTO modules VALUES(?,?)")
        .run(m.id, json(m));
    if (!options.skipNoteRecovery) this.flushNotes();
  }
  close() {
    this.db.close();
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    let result: T;
    try {
      result = fn();
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    this.faultAfterCommit?.();
    this.flushNotes();
    return result;
  }
  flushNotes() {
    for (const r of this.db.prepare("SELECT * FROM pending_notes").all()) {
      const id = String(r.id),
        text = String(r.markdown),
        current = this.vault.read(id);
      if (current?.hash === hash(text)) {
        this.db.prepare("DELETE FROM pending_notes WHERE id=?").run(id);
        continue;
      }
      if ((current?.hash ?? "") !== r.base_hash)
        throw Error(
          "Pending Markdown conflict for " +
            id +
            "; external file preserved. Use note recovery.",
        );
      this.vault.write(id, text);
      this.db.prepare("DELETE FROM pending_notes WHERE id=?").run(id);
    }
  }
  recoverNote(id: string, choice: "external" | "pending") {
    const r = this.db.prepare("SELECT * FROM pending_notes WHERE id=?").get(id);
    if (!r) throw Error("No pending note");
    const external = this.vault.read(id);
    if (choice === "external") {
      writeFileSync(
        join(this.root, "note-conflict-" + uuid() + ".md"),
        String(r.markdown),
        { mode: 0o600 },
      );
      this.db.prepare("DELETE FROM pending_notes WHERE id=?").run(id);
      this.captureExternalNotes();
    } else {
      if (external)
        writeFileSync(
          join(this.root, "note-conflict-" + uuid() + ".md"),
          external.markdown,
          { mode: 0o600 },
        );
      this.db
        .prepare("UPDATE pending_notes SET base_hash=? WHERE id=?")
        .run(external?.hash ?? "", id);
      this.flushNotes();
    }
  }
  permit(
    cap: Capability,
    action: "read" | "write" | "suggest",
    module: string,
  ) {
    if (!cap[action].includes("*") && !cap[action].includes(module))
      throw Error("Permission denied: " + action);
    if (action === "write" && cap.role === "ai")
      throw Error("AI may only suggest");
  }
  modules() {
    return this.db
      .prepare("SELECT json FROM modules ORDER BY id")
      .all()
      .map((r) => parse<Module>(r)!);
  }
  register(m: Module) {
    validateModule(m);
    if (this.modules().some((x) => x.id === m.id))
      throw Error("Module already registered");
    this.db.prepare("INSERT INTO modules VALUES(?,?)").run(m.id, json(m));
  }
  setEnabled(id: string, enabled: boolean) {
    const m = this.module(id, false);
    m.enabled = enabled;
    this.db.prepare("UPDATE modules SET json=? WHERE id=?").run(json(m), id);
  }
  module(id: string, enabled = true) {
    const m = parse<Module>(
      this.db.prepare("SELECT json FROM modules WHERE id=?").get(id),
    );
    if (!m) throw Error("Unknown module");
    if (enabled && !m.enabled) throw Error("Module disabled; data preserved");
    return m;
  }
  raw(id: string) {
    return parse<Omit<Entity, "body" | "noteHash">>(
      this.db.prepare("SELECT json FROM entities WHERE id=?").get(id),
    );
  }
  snapshot(id: string): Snapshot | null {
    const r = this.raw(id);
    if (!r) return null;
    const pending = this.db
      .prepare("SELECT markdown FROM pending_notes WHERE id=?")
      .get(id);
    const note = this.vault.read(id);
    if (!pending && !note) throw Error("Linked note missing: " + id);
    const markdown = pending ? String(pending.markdown) : note!.markdown;
    const parsed = splitNote(markdown);
    if (parsed.doc.get("life_module") !== r.module)
      throw Error("Note module identity changed");
    return { ...r, body: parsed.body, markdown };
  }
  get(id: string, cap = HUMAN): Entity | null {
    const r = this.raw(id);
    if (!r) return null;
    this.permit(cap, "read", r.module);
    const s = this.snapshot(id)!;
    const { markdown, ...data } = s;
    return { ...data, noteHash: hash(markdown) };
  }
  list(
    filter: { module?: string; q?: string; includeDeleted?: boolean } = {},
    cap = HUMAN,
  ) {
    if (filter.module) this.permit(cap, "read", filter.module);
    return this.db
      .prepare("SELECT id,module FROM entities ORDER BY id")
      .all()
      .filter(
        (r) =>
          (!filter.module || r.module === filter.module) &&
          (cap.read.includes("*") || cap.read.includes(String(r.module))),
      )
      .map((r) => this.get(String(r.id), cap)!)
      .filter(
        (r) =>
          (filter.includeDeleted || !r.deleted) &&
          (!filter.q || json(r).toLowerCase().includes(filter.q.toLowerCase())),
      );
  }
  validate(
    s: Snapshot,
    lookup: (id: string) => Snapshot | null = (id) => this.snapshot(id),
    allowDisabled = false,
  ) {
    const m = this.module(s.module, !allowDisabled),
      t = m.entityTypes.find((t) => t.id === s.type);
    if (
      !t ||
      !validId(s.id) ||
      typeof s.title !== "string" ||
      !s.title.trim() ||
      s.title.length > 300 ||
      !["plan", "fact", "inference"].includes(s.kind) ||
      !["draft", "active", "done", "failed"].includes(s.status) ||
      typeof s.deleted !== "boolean" ||
      !Number.isSafeInteger(s.version) ||
      s.version < 1 ||
      s.schemaVersion !== m.schemaVersion ||
      !s.source ||
      !["manual", "import", "device", "rule"].includes(s.source.mode) ||
      !s.source.namespace ||
      !s.source.recordId ||
      !s.source.revision ||
      !Array.isArray(s.relations) ||
      s.relations.length > 100 ||
      typeof s.body !== "string" ||
      s.body.length > 200000
    )
      throw Error("Invalid entity");
    if (
      !/^\d{4}-\d{2}-\d{2}(T.*(?:Z|[+-]\d{2}:\d{2}))?$/.test(s.occurredAt) ||
      !Number.isFinite(Date.parse(s.occurredAt))
    )
      throw Error("Use ISO date or offset-aware timestamp");
    if (
      s.occurredAt.length === 10 &&
      new Date(s.occurredAt).toISOString().slice(0, 10) !== s.occurredAt
    )
      throw Error("Invalid calendar date");
    new Intl.DateTimeFormat("en", { timeZone: s.timeZone });
    if (
      !Number.isFinite(Date.parse(s.createdAt)) ||
      !Number.isFinite(Date.parse(s.updatedAt))
    )
      throw Error("Invalid audit time");
    const validate = ajv.compile(fieldsSchema(t));
    if (!validate(s.fields))
      throw Error("Invalid fields: " + ajv.errorsText(validate.errors));
    for (const [k, v] of Object.entries(s.fields)) {
      if (k === "parameters") {
        try {
          if (typeof JSON.parse(String(v)) !== "object") throw Error();
        } catch {
          throw Error("Parameters must be JSON");
        }
      }
      if (k === "effort" && (Number(v) < 0 || Number(v) > 10))
        throw Error("Effort must be 0–10");
      if (k === "currency" && !/^[A-Z]{3}$/.test(String(v)))
        throw Error("Currency must be a three-letter code");
      if (
        t.fields.find((f) => f.key === k)?.type === "date" &&
        new Date(String(v)).toISOString().slice(0, 10) !== v
      )
        throw Error("Invalid calendar date");
    }
    const seen = new Set();
    for (const rel of s.relations) {
      const rule = m.relations.find((r) => r.id === rel.type),
        target = lookup(rel.target);
      if (
        !rule ||
        !target ||
        (!rule.targetModules.includes("*") &&
          !rule.targetModules.includes(target.module)) ||
        seen.has(rel.type + ":" + rel.target)
      )
        throw Error("Invalid relation");
      seen.add(rel.type + ":" + rel.target);
      if (
        rule.max &&
        s.relations.filter((r) => r.type === rel.type).length > rule.max
      )
        throw Error("Relation cardinality exceeded");
    }
    const n = splitNote(s.markdown);
    if (
      n.doc.get("life_id") !== s.id ||
      n.doc.get("life_module") !== s.module ||
      n.body !== s.body
    )
      throw Error("Note identity/body mismatch");
  }
  writeSnapshot(s: Snapshot, op: Operation, actor: string, action: string) {
    const old = this.snapshot(s.id),
      pending = this.db
        .prepare("SELECT base_hash FROM pending_notes WHERE id=?")
        .get(s.id);
    const { markdown, ...data } = s;
    delete (data as Partial<Snapshot>).body;
    this.db
      .prepare("INSERT OR REPLACE INTO entities VALUES(?,?,?)")
      .run(s.id, s.module, json(data));
    this.db.prepare("DELETE FROM edges WHERE source=?").run(s.id);
    for (const r of s.relations)
      this.db
        .prepare("INSERT INTO edges VALUES(?,?,?)")
        .run(s.id, r.target, r.type);
    this.db
      .prepare("INSERT OR REPLACE INTO pending_notes VALUES(?,?,?)")
      .run(
        s.id,
        pending ? String(pending.base_hash) : old ? hash(old.markdown) : "",
        markdown,
      );
    this.db
      .prepare("INSERT OR REPLACE INTO note_index VALUES(?,?)")
      .run(s.id, markdown);
    this.db
      .prepare("INSERT INTO operations(id,json) VALUES(?,?)")
      .run(op.id, json(op));
    this.db
      .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?)")
      .run(uuid(), s.id, actor, action, s.version, now());
  }
  build(
    req: SaveRequest,
    cap: Capability,
  ): { value: Snapshot; base: Snapshot | null } {
    const input = req.entity,
      id = input.id ?? uuid(),
      base = this.snapshot(id);
    this.permit(cap, cap.role === "ai" ? "suggest" : "write", input.module);
    if (
      cap.role === "ai" &&
      (input.kind !== "inference" || input.status !== "draft" || base)
    )
      throw Error("AI may create draft inferences only");
    if (
      base &&
      (base.module !== input.module ||
        base.type !== input.type ||
        base.kind !== input.kind)
    )
      throw Error("Identity and information kind are immutable");
    if ((base?.version ?? 0) !== req.expectedVersion)
      throw Error("Version conflict");
    if (base && req.expectedNoteHash !== hash(base.markdown))
      throw Error("Markdown changed externally; reload before editing");
    const timestamp = now();
    const value: Snapshot = {
      id,
      module: input.module,
      type: input.type,
      title: input.title,
      kind: input.kind,
      status: input.status,
      occurredAt: input.occurredAt,
      timeZone: input.timeZone,
      fields: input.fields,
      relations: input.relations,
      body: input.body,
      source: input.source ??
        base?.source ?? {
          namespace: "manual",
          recordId: id,
          revision: String((base?.version ?? 0) + 1),
          mode: cap.role === "ai" ? "rule" : "manual",
        },
      createdAt: base?.createdAt ?? timestamp,
      updatedAt: timestamp,
      actor: cap.actor,
      version: (base?.version ?? 0) + 1,
      schemaVersion: this.module(input.module).schemaVersion,
      deleted: input.deleted ?? base?.deleted ?? false,
      markdown: this.vault.compose(
        id,
        input.module,
        input.body,
        base?.markdown,
      ),
    };
    this.validate(value);
    return { value, base };
  }
  saveInTransaction(req: SaveRequest, cap: Capability) {
    const opId = req.operationId ?? uuid();
    if (!validId(opId)) throw Error("Invalid operation ID");
    this.permit(
      cap,
      cap.role === "ai" ? "suggest" : "write",
      req.entity.module,
    );
    if (
      cap.role === "ai" &&
      (req.entity.kind !== "inference" ||
        req.entity.status !== "draft" ||
        req.expectedVersion !== 0)
    )
      throw Error("AI may create draft inferences only");
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
    const digest = hash(json(canonical({ ...req, operationId: undefined })));
    const prior = this.db
      .prepare("SELECT digest,entity FROM requests WHERE id=?")
      .get(opId);
    if (prior) {
      if (prior.digest !== digest)
        throw Error("Operation ID reused with different content");
      this.permit(cap, "read", this.raw(String(prior.entity))!.module);
      return String(prior.entity);
    }
    const { value, base } = this.build(req, cap);
    for (const rel of value.relations) {
      const target = this.raw(rel.target);
      if (target) this.permit(cap, "read", target.module);
    }
    const seq = Number(
      this.db
        .prepare("SELECT COALESCE(MAX(seq),0)+1 AS n FROM operations")
        .get()!.n,
    );
    this.writeSnapshot(
      value,
      {
        id: opId,
        device: this.device,
        sequence: seq,
        entityId: value.id,
        base,
        value,
        at: now(),
      },
      cap.actor,
      cap.role === "ai" ? "suggest" : "save",
    );
    this.db
      .prepare("INSERT INTO requests VALUES(?,?,?)")
      .run(opId, digest, value.id);
    return value.id;
  }
  save(req: SaveRequest, cap = HUMAN) {
    this.flushNotes();
    const id = this.transaction(() => this.saveInTransaction(req, cap));
    return this.get(id, cap)!;
  }
  saveMany(requests: SaveRequest[], cap = HUMAN) {
    this.flushNotes();
    const ids = this.transaction(() =>
      requests.map((req) => this.saveInTransaction(req, cap)),
    );
    return ids.map((id) => this.get(id, cap)!);
  }
  importSource(input: EntityInput, cap = HUMAN) {
    const src = input.source;
    if (!src || src.mode === "manual")
      throw Error("Importer requires a source identity");
    this.permit(cap, "write", input.module);
    const digest = hash(json({ ...input, id: undefined }));
    const id = this.transaction(() => {
      const receipt = this.db
        .prepare(
          "SELECT * FROM source_receipts WHERE namespace=? AND source_id=? AND revision=?",
        )
        .get(src.namespace, src.recordId, src.revision);
      if (receipt) {
        if (receipt.digest !== digest)
          throw Error("Source revision changed without a new revision");
        return String(receipt.entity);
      }
      const prior = this.db
        .prepare("SELECT * FROM imports WHERE namespace=? AND source_id=?")
        .get(src.namespace, src.recordId);
      const old = prior ? this.get(String(prior.entity), cap) : null;
      const savedId = this.saveInTransaction(
        {
          entity: { ...input, id: old?.id ?? input.id },
          expectedVersion: old?.version ?? 0,
          expectedNoteHash: old?.noteHash,
          operationId: hash(
            src.namespace + "|" + src.recordId + "|" + src.revision,
          ),
        },
        cap,
      );
      this.db
        .prepare("INSERT OR REPLACE INTO imports VALUES(?,?,?,?,?)")
        .run(src.namespace, src.recordId, src.revision, savedId, digest);
      this.db
        .prepare("INSERT INTO source_receipts VALUES(?,?,?,?,?)")
        .run(src.namespace, src.recordId, src.revision, digest, savedId);
      return savedId;
    });
    return this.get(id, cap)!;
  }
  captureExternalNotes() {
    this.flushNotes();
    const changed = this.db
      .prepare("SELECT id,markdown FROM note_index")
      .all()
      .filter((row) => {
        const note = this.vault.read(String(row.id));
        if (!note) throw Error("Linked note missing: " + row.id);
        return hash(String(row.markdown)) !== note.hash;
      });
    if (!changed.length) return 0;
    this.transaction(() => {
      for (const row of changed) {
        const current = this.snapshot(String(row.id))!,
          base = {
            ...current,
            body: splitNote(String(row.markdown)).body,
            markdown: String(row.markdown),
          };
        const value = {
          ...current,
          version: current.version + 1,
          updatedAt: now(),
          actor: "markdown-editor",
        };
        this.validate(value, undefined, true);
        const sequence = Number(
          this.db
            .prepare("SELECT COALESCE(MAX(seq),0)+1 AS n FROM operations")
            .get()!.n,
        );
        this.writeSnapshot(
          value,
          {
            id: uuid(),
            device: this.device,
            sequence,
            entityId: value.id,
            base,
            value,
            at: now(),
          },
          "markdown-editor",
          "external-note",
        );
      }
    });
    return changed.length;
  }
  exportPacket(cursor = 0, modules: string[] = []): SyncPacket {
    this.captureExternalNotes();
    if (!Number.isSafeInteger(cursor) || cursor < 0)
      throw Error("Invalid cursor");
    const rows = this.db
      .prepare(
        "SELECT seq,json FROM operations WHERE seq>? ORDER BY seq LIMIT 500",
      )
      .all(cursor);
    const operations = rows
      .map((r) => parse<Operation>(r)!)
      .filter(
        (o) => modules.includes(o.value.module) && o.value.module !== "family",
      );
    const payload = {
      protocol: 1 as const,
      batchId: uuid(),
      device: this.device,
      from: cursor,
      to: rows.length ? Number(rows.at(-1)!.seq) : cursor,
      complete: true as const,
      operations,
    };
    return { ...payload, sha256: hash(json(payload)) };
  }
  importPacket(packet: SyncPacket, allowed: string[]) {
    this.captureExternalNotes();
    const { sha256, ...payload } = packet;
    if (
      packet.protocol !== 1 ||
      packet.complete !== true ||
      !validId(packet.device) ||
      !validId(packet.batchId) ||
      !Number.isSafeInteger(packet.from) ||
      packet.from < 0 ||
      !Number.isSafeInteger(packet.to) ||
      packet.to < packet.from ||
      !Array.isArray(packet.operations) ||
      packet.operations.length > 500 ||
      hash(json(payload)) !== sha256
    )
      throw Error("Invalid/incomplete sync packet");
    const cursor = Number(
      this.db
        .prepare("SELECT seq FROM cursors WHERE device=?")
        .get(packet.device)?.seq ?? 0,
    );
    if (packet.from > cursor)
      throw Error("Sync gap: request from saved cursor");
    let applied = 0,
      conflicts = 0;
    const result = this.transaction(() => {
      for (const op of packet.operations) {
        if (
          !validId(op.id) ||
          !validId(op.device) ||
          op.entityId !== op.value.id ||
          !allowed.includes(op.value.module) ||
          op.value.module === "family" ||
          (op.base?.id && op.base.id !== op.value.id)
        )
          throw Error("Sync permission or operation rejected");
        if (
          this.db.prepare("SELECT 1 FROM operations WHERE id=?").get(op.id) ||
          this.db.prepare("SELECT 1 FROM conflicts WHERE id=?").get(op.id)
        )
          continue;
        const local = this.snapshot(op.entityId);
        for (const existing of [local, op.base]) {
          if (
            existing &&
            (!allowed.includes(existing.module) ||
              existing.module === "family" ||
              existing.module !== op.value.module ||
              existing.type !== op.value.type ||
              existing.kind !== op.value.kind)
          )
            throw Error("Sync identity or permission rejected");
        }
        if (
          op.resolves &&
          (!Array.isArray(op.resolves) ||
            op.resolves.some((id) => !validId(id)))
        )
          throw Error("Invalid conflict resolution");
        let merged = mergeSnapshots(op.base, local, op.value);
        if (merged) {
          merged = {
            ...merged,
            version: (local?.version ?? 0) + 1,
            updatedAt: now(),
            body: splitNote(merged.markdown).body,
          };
          this.validate(merged);
          this.writeSnapshot(merged, op, "sync", "sync");
          for (const resolved of op.resolves ?? [])
            this.db
              .prepare(
                "DELETE FROM conflicts WHERE id=? AND json_extract(json,'$.operation.entityId')=?",
              )
              .run(resolved, op.entityId);
          applied++;
        } else {
          this.db.prepare("INSERT INTO conflicts VALUES(?,?)").run(
            op.id,
            json({
              id: op.id,
              operation: op,
              local,
              reason: "Competing edits or missing base",
            }),
          );
          conflicts++;
        }
      }
      this.db
        .prepare("INSERT OR REPLACE INTO cursors VALUES(?,?)")
        .run(packet.device, Math.max(cursor, packet.to));
      return {
        applied,
        conflicts,
        cursor: Math.max(cursor, packet.to),
        mode: "local simulation only",
      };
    });
    return result;
  }
  conflicts(): Conflict[] {
    this.captureExternalNotes();
    return this.db
      .prepare("SELECT json FROM conflicts")
      .all()
      .map((r) => {
        const c = parse<Conflict>(r)!;
        return { ...c, local: this.snapshot(c.operation.entityId) };
      });
  }
  resolveConflict(
    id: string,
    choice: "local" | "incoming",
    expectedVersion?: number,
  ) {
    this.captureExternalNotes();
    if (!["local", "incoming"].includes(choice))
      throw Error("Invalid conflict choice");
    const c = parse<Conflict>(
      this.db.prepare("SELECT json FROM conflicts WHERE id=?").get(id),
    );
    if (!c) throw Error("Unknown conflict");
    const current = this.snapshot(c.operation.entityId);
    if (
      expectedVersion !== undefined &&
      (current?.version ?? 0) !== expectedVersion
    )
      throw Error("Version conflict during resolution");
    const selected = choice === "local" ? current : c.operation.value;
    if (!selected) throw Error("Missing selected entity");
    const ids = this.db
      .prepare(
        "SELECT id FROM operations WHERE json_extract(json,'$.entityId')=?",
      )
      .all(c.operation.entityId)
      .map((r) => String(r.id));
    ids.push(c.operation.id);
    const value = {
      ...selected,
      version: (current?.version ?? 0) + 1,
      updatedAt: now(),
      actor: "local-user",
    };
    this.validate(value);
    this.transaction(() => {
      const seq = Number(
        this.db
          .prepare("SELECT COALESCE(MAX(seq),0)+1 AS n FROM operations")
          .get()!.n,
      );
      const op: Operation = {
        id: uuid(),
        device: this.device,
        sequence: seq,
        entityId: value.id,
        base: c.operation.value,
        value,
        at: now(),
        resolves: ids,
      };
      this.writeSnapshot(value, op, "local-user", "resolve-conflict");
      this.db
        .prepare("INSERT OR IGNORE INTO operations(id,json) VALUES(?,?)")
        .run(c.operation.id, json(c.operation));
      this.db.prepare("DELETE FROM conflicts WHERE id=?").run(id);
    });
    return this.get(value.id)!;
  }
  backup() {
    this.captureExternalNotes();
    const tables = [
      "meta",
      "migrations",
      "modules",
      "entities",
      "edges",
      "operations",
      "audit",
      "conflicts",
      "cursors",
      "imports",
      "note_index",
      "requests",
      "source_receipts",
      "module_migrations",
    ];
    const data = {
      format: 1,
      tables: Object.fromEntries(
        tables.map((t) => [t, this.db.prepare("SELECT * FROM " + t).all()]),
      ),
      notes: this.list({ includeDeleted: true }).map((e) => ({
        id: e.id,
        markdown: this.vault.read(e.id)!.markdown,
      })),
    };
    const payload = json(data);
    return { payload, sha256: hash(payload) };
  }
  static restore(root: string, b: { payload: string; sha256: string }) {
    if (existsSync(root)) throw Error("Restore requires a new destination");
    if (hash(b.payload) !== b.sha256) throw Error("Backup checksum mismatch");
    const data = JSON.parse(b.payload);
    if (data.format !== 1 || !Array.isArray(data.notes))
      throw Error("Unsupported backup");
    const s = new Store(root);
    s.transaction(() => {
      for (const [table, rows] of Object.entries(data.tables)) {
        if (
          ![
            "meta",
            "migrations",
            "modules",
            "entities",
            "edges",
            "operations",
            "audit",
            "conflicts",
            "cursors",
            "imports",
            "note_index",
            "requests",
            "source_receipts",
            "module_migrations",
          ].includes(table)
        )
          throw Error("Invalid backup table");
        s.db.exec("DELETE FROM " + table);
        for (const row of rows as Record<string, unknown>[]) {
          const cols = Object.keys(row);
          if (cols.some((k) => !/^[a-z_]+$/.test(k)))
            throw Error("Invalid column");
          s.db
            .prepare(
              `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
            )
            .run(...(Object.values(row) as any));
        }
      }
      for (const note of data.notes) {
        if (
          !validId(note.id) ||
          splitNote(note.markdown).doc.get("life_id") !== note.id
        )
          throw Error("Invalid backup note");
        s.db
          .prepare("INSERT INTO pending_notes VALUES(?,?,?)")
          .run(note.id, "", note.markdown);
      }
      s.device = uuid();
      s.db.prepare("UPDATE meta SET value=? WHERE key='device'").run(s.device);
      s.db
        .prepare(
          "INSERT OR REPLACE INTO meta VALUES('restored_isolated','true')",
        )
        .run();
    });
    for (const m of s.modules()) validateModule(m);
    for (const e of s.list({ includeDeleted: true }))
      s.validate(s.snapshot(e.id)!, undefined, true);
    return s;
  }
  migrateModule(next: Module, renames: Record<string, string> = {}) {
    validateModule(next);
    const old = this.module(next.id, false);
    if (next.schemaVersion !== old.schemaVersion + 1)
      throw Error("Migration must advance exactly one schema version");
    const backup = this.backup();
    const path = join(this.root, "migration-backup-" + uuid() + ".json");
    writeFileSync(path, json(backup), { mode: 0o600 });
    this.transaction(() => {
      this.db
        .prepare("UPDATE modules SET json=? WHERE id=?")
        .run(json(next), next.id);
      for (const e of this.list({ module: next.id, includeDeleted: true })) {
        const base = this.snapshot(e.id)!,
          value = structuredClone(base);
        for (const [from, to] of Object.entries(renames)) {
          if (from in value.fields) {
            if (to in value.fields) throw Error("Migration field collision");
            value.fields[to] = value.fields[from];
            delete value.fields[from];
          }
        }
        value.schemaVersion = next.schemaVersion;
        value.version++;
        value.updatedAt = now();
        this.validate(value);
        const seq = Number(
          this.db
            .prepare("SELECT COALESCE(MAX(seq),0)+1 AS n FROM operations")
            .get()!.n,
        );
        this.writeSnapshot(
          value,
          {
            id: uuid(),
            device: this.device,
            sequence: seq,
            entityId: e.id,
            base,
            value,
            at: now(),
          },
          "local-user",
          "migration",
        );
      }
      this.db
        .prepare("INSERT INTO module_migrations VALUES(?,?,?,?)")
        .run(next.id, old.schemaVersion, next.schemaVersion, now());
    });
    return { backup: path };
  }
  audit() {
    return this.db.prepare("SELECT * FROM audit ORDER BY at").all();
  }
}
