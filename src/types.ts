export type Field = {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "decimal" | "date";
  required?: boolean;
  options?: string[];
  min?: number;
};
export type EntityType = { id: string; name: string; fields: Field[] };
export type Module = {
  id: string;
  name: string;
  version: string;
  coreApi: 1;
  schemaVersion: number;
  codeVisibility: "public" | "private";
  enabled: boolean;
  entityTypes: EntityType[];
  relations: {
    id: string;
    name: string;
    targetModules: string[];
    max?: number;
  }[];
  views: ("list" | "timeline" | "form")[];
  contract?: import("./module-contract.js").ModuleContract;
};
export type Source = {
  namespace: string;
  recordId: string;
  revision: string;
  mode: "manual" | "import" | "device" | "rule";
};
export type Entity = {
  id: string;
  module: string;
  type: string;
  title: string;
  kind: "plan" | "fact" | "inference";
  status: "draft" | "active" | "done" | "failed";
  occurredAt: string;
  timeZone: string;
  createdAt: string;
  updatedAt: string;
  actor: string;
  version: number;
  schemaVersion: number;
  source: Source;
  fields: Record<string, string | number>;
  relations: { type: string; target: string }[];
  body: string;
  noteHash: string;
  deleted: boolean;
};
export type EntityInput = Pick<
  Entity,
  | "module"
  | "type"
  | "title"
  | "kind"
  | "status"
  | "occurredAt"
  | "timeZone"
  | "fields"
  | "relations"
  | "body"
> &
  Partial<Pick<Entity, "id" | "source" | "deleted">>;
export type SaveRequest = {
  entity: EntityInput;
  expectedVersion: number;
  expectedNoteHash?: string;
  operationId?: string;
};
export type Capability = {
  actor: string;
  role: "human" | "ai" | "sync";
  read: string[];
  write: string[];
  suggest: string[];
  scope?: Record<string, EntityScope>;
};
export type EntityScope = {
  entityIds?: string[];
  entityTypes?: string[];
  fields?: string[];
  body?: boolean;
  relations?: boolean;
  metadata?: (
    | "title"
    | "source"
    | "actor"
    | "createdAt"
    | "updatedAt"
    | "occurredAt"
    | "timeZone"
  )[];
};
export type SyncScope = {
  modules: string[];
  entities?: Record<string, EntityScope>;
};
export type SyncBootstrap = {
  protocol: 2;
  mode: "bootstrap";
  batchId: string;
  device: string;
  cursor: number;
  scope: SyncScope;
  modules: Module[];
  records: Snapshot[];
  seen: { id: string; entityId: string; digest: string }[];
  sourceReceipts: {
    namespace: string;
    source_id: string;
    revision: string;
    entity: string;
    digest: string;
  }[];
  imports: {
    namespace: string;
    source_id: string;
    revision: string;
    entity: string;
    digest: string;
  }[];
  sha256: string;
};
export type SyncProjection = {
  protocol: 2;
  mode: "projection";
  batchId: string;
  device: string;
  cursor: number;
  scope: SyncScope;
  records: Entity[];
  sha256: string;
};
export const HUMAN: Capability = {
  actor: "local-user",
  role: "human",
  read: ["*"],
  write: ["*"],
  suggest: ["*"],
};
export type Snapshot = Omit<Entity, "noteHash"> & { markdown: string };
export type Operation = {
  id: string;
  device: string;
  sequence: number;
  entityId: string;
  base: Snapshot | null;
  value: Snapshot;
  at: string;
  resolves?: string[];
};
export type SyncPacket = {
  protocol: 1;
  batchId: string;
  device: string;
  from: number;
  to: number;
  complete: true;
  operations: Operation[];
  sha256: string;
};
export type Conflict = {
  id: string;
  operation: Operation;
  local: Snapshot | null;
  reason: string;
};
export type PlanInput = {
  date: string;
  timeZone: string;
  scenario: "normal" | "overtime" | "fatigue";
  startMinute: number;
  endMinute: number;
  protected: { label: string; start: number; end: number }[];
  buffers: {
    meals: number;
    commute: number;
    preparation: number;
    recovery: number;
    sleep: number;
  };
  goals: { id: string; title: string; minutes: number }[];
};
export type PlanDraft = {
  kind: "inference";
  ruleVersion: string;
  input: PlanInput;
  slots: { goalId: string; title: string; start: number; end: number }[];
  unscheduled: { id: string; minutes: number }[];
  issues: string[];
  accepted: false;
};
