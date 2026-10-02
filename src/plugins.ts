import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { validateModule } from "./modules.js";
import { projectRoot } from "./paths.js";
import {
  compatibleVersion,
  compareVersions,
  validateContract,
  validatePermissionSchema,
} from "./module-contract.js";
import type {
  ModuleContract,
  ModuleOperation,
  ModulePermission,
} from "./module-contract.js";
import type { Capability, Entity, Module, SaveRequest } from "./types.js";
import type { Store } from "./store.js";

export type PluginManifest = {
  protocol: 1;
  module: Module & { contract: ModuleContract };
  entry?: string;
};
export type PluginAuthorization = {
  permissions?: string[];
  trustLocalCode?: boolean;
  acknowledgeUnsandboxedNetwork?: boolean;
};
export type PluginEvent = {
  at: string;
  action: string;
  ok: boolean;
  message?: string;
};
export type PluginInstallation = {
  id: string;
  manifest: PluginManifest;
  manifestPath: string;
  entryPath?: string;
  entryHash?: string;
  state: "installed" | "enabled" | "disabled" | "uninstalled";
  authorized: boolean;
  grants: string[];
  trustedLocalCode: boolean;
  acknowledgeUnsandboxedNetwork: boolean;
  lastError?: string;
  events: PluginEvent[];
};
export const PLUGIN_RUNTIME_LIMITATIONS =
  "Trusted local code only. Node --permission restricts filesystem, child processes, workers and addons; it is not a malicious-code sandbox and does not block direct network/system calls. External broker actions are always disabled. Use OS isolation before running untrusted code.";
const digest = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => JSON.stringify(value);
const inside = (root: string, path: string) => {
  const part = relative(root, path);
  return (
    part === "" ||
    (!part.startsWith(".." + (process.platform === "win32" ? "\\" : "/")) &&
      part !== ".." &&
      !isAbsolute(part))
  );
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
type PendingWrite = { request: SaveRequest; capability: Capability };

/** Runtime manifests and this private execution configuration stay outside the repository.
 * plugin-state.json is deliberately not part of Store's data backup. Restored data
 * requires installation and a fresh explicit authorization; imported text never installs code.
 */
export class PluginManager {
  private statePath: string;
  private installations: PluginInstallation[];
  private repositoryRoot: string;
  private active = new Set<string>();
  constructor(
    private store: Store,
    private options: {
      repositoryRoot?: string;
      timeoutMs?: number;
      maxOutputBytes?: number;
    } = {},
  ) {
    this.repositoryRoot = realpathSync(options.repositoryRoot ?? projectRoot);
    const root = realpathSync(store.root);
    if (inside(this.repositoryRoot, root))
      throw Error("Plugin execution configuration must be outside repository");
    this.statePath = join(root, "plugin-state.json");
    this.installations = this.readState();
  }
  private readState(): PluginInstallation[] {
    if (existsSync(this.statePath)) {
      if (
        !lstatSync(this.statePath).isFile() ||
        lstatSync(this.statePath).isSymbolicLink()
      )
        throw Error("Invalid plugin state file");
      const state = JSON.parse(readFileSync(this.statePath, "utf8"));
      if (state.protocol !== 1 || !Array.isArray(state.installations))
        throw Error("Invalid plugin state protocol");
      const installations: PluginInstallation[] = state.installations;
      const ids = new Set<string>();
      for (const p of installations) {
        validateModule(p.manifest?.module);
        validateContract(p.manifest.module);
        if (
          p.manifest.protocol !== 1 ||
          !p.manifest.module.contract ||
          p.id !== p.manifest.module.id ||
          ids.has(p.id) ||
          !["installed", "enabled", "disabled", "uninstalled"].includes(
            p.state,
          ) ||
          typeof p.authorized !== "boolean" ||
          !Array.isArray(p.grants) ||
          p.grants.some(
            (id: string) =>
              !p.manifest.module.contract.permissions.some((g) => g.id === id),
          ) ||
          typeof p.trustedLocalCode !== "boolean" ||
          typeof p.acknowledgeUnsandboxedNetwork !== "boolean" ||
          !Array.isArray(p.events)
        )
          throw Error("Invalid plugin execution configuration");
        ids.add(p.id);
      }
      return installations;
    }
    return [];
  }
  private persist() {
    const temp = this.statePath + "." + randomUUID() + ".tmp";
    try {
      writeFileSync(
        temp,
        json({ protocol: 1, installations: this.installations }),
        { mode: 0o600, flag: "wx" },
      );
      renameSync(temp, this.statePath);
    } finally {
      rmSync(temp, { force: true });
    }
  }
  private event(
    p: PluginInstallation,
    action: string,
    ok: boolean,
    error?: unknown,
  ) {
    // An async invocation must not overwrite authorization changed by another
    // manager (for example the CLI while the local server is running).
    if (action.startsWith("invoke:") || action.startsWith("import:")) {
      this.installations = this.readState();
      p = this.installations.find((current) => current.id === p.id) ?? p;
    }
    const reason = error === undefined ? undefined : message(error);
    p.events.push({
      at: new Date().toISOString(),
      action,
      ok,
      ...(reason ? { message: reason } : {}),
    });
    if (p.events.length > 200) p.events.splice(0, p.events.length - 200);
    if (ok) delete p.lastError;
    else p.lastError = reason;
    this.persist();
  }
  private installation(id: string) {
    this.installations = this.readState();
    const p = this.installations.find((p) => p.id === id);
    if (!p || p.state === "uninstalled") throw Error("Plugin not installed");
    return p;
  }
  private guard<T>(
    id: string,
    action: string,
    fn: (p: PluginInstallation) => T,
  ): T {
    const p = this.installation(id);
    try {
      const result = fn(p);
      this.event(p, action, true);
      return result;
    } catch (error) {
      this.event(p, action, false, error);
      throw error;
    }
  }
  private externalFile(path: string) {
    const absolute = resolve(path);
    if (lstatSync(absolute).isSymbolicLink() || !lstatSync(absolute).isFile())
      throw Error("Plugin file must be a regular file; symlinks denied");
    const canonical = realpathSync(absolute);
    if (
      inside(this.repositoryRoot, canonical) ||
      inside(realpathSync(this.store.root), canonical)
    )
      throw Error(
        "Plugin manifests and code must be outside repository and private data root",
      );
    if (lstatSync(canonical).size > 1024 * 1024)
      throw Error("Plugin file exceeds size limit");
    return canonical;
  }
  private load(path: string) {
    const manifestPath = this.externalFile(path);
    const manifest = JSON.parse(
      readFileSync(manifestPath, "utf8"),
    ) as PluginManifest;
    if (!manifest || manifest.protocol !== 1 || !manifest.module?.contract)
      throw Error("Plugin manifest requires protocol and module contract");
    validateModule(manifest.module);
    validateContract(manifest.module);
    if (
      manifest.entry !== undefined &&
      (typeof manifest.entry !== "string" ||
        !/^[a-zA-Z0-9_-]+\.mjs$/.test(manifest.entry))
    )
      throw Error("Plugin entry must be a single bundled local .mjs file");
    if (
      manifest.module.contract.operations.some((o) => o.handler === "stdio") &&
      !manifest.entry
    )
      throw Error("Stdio operation requires entry");
    const entryPath = manifest.entry
      ? this.externalFile(join(dirname(manifestPath), manifest.entry))
      : undefined;
    if (entryPath && dirname(entryPath) !== dirname(manifestPath))
      throw Error("Plugin entry must be beside manifest");
    return {
      manifest,
      manifestPath,
      ...(entryPath
        ? { entryPath, entryHash: digest(readFileSync(entryPath)) }
        : {}),
    };
  }
  private dependencies(module: PluginManifest["module"], enabled: boolean) {
    const all = this.store
      .modules()
      .filter((m) => m.id !== module.id)
      .concat(module);
    for (const d of module.contract.dependencies) {
      const target = all.find((m) => m.id === d.module);
      if (
        !target ||
        !compatibleVersion(
          target.version,
          d.minVersion,
          d.maxVersionExclusive,
        ) ||
        (enabled && !target.enabled)
      )
        throw Error(
          "Missing, incompatible or disabled dependency: " + d.module,
        );
    }
    for (const p of module.contract.permissions) {
      const target = all.find((m) => m.id === p.module);
      if (!target) throw Error("Missing permission module");
      validatePermissionSchema(p, target);
    }
    const visiting = new Set<string>(),
      visited = new Set<string>();
    const visit = (id: string) => {
      if (visiting.has(id)) throw Error("Cyclic module dependency");
      if (visited.has(id)) return;
      visiting.add(id);
      const m = all.find((m) => m.id === id) as
        (Module & { contract?: ModuleContract }) | undefined;
      for (const d of m?.contract?.dependencies ?? []) visit(d.module);
      visiting.delete(id);
      visited.add(id);
    };
    visit(module.id);
    for (const m of all as (Module & { contract?: ModuleContract })[]) {
      for (const d of m.contract?.dependencies ?? [])
        if (
          d.module === module.id &&
          !compatibleVersion(
            module.version,
            d.minVersion,
            d.maxVersionExclusive,
          )
        )
          throw Error("Upgrade would break dependent module: " + m.id);
    }
  }
  private notRunning(id: string) {
    if (this.active.has(id)) throw Error("Plugin operation currently running");
  }
  private noEnabledDependents(id: string) {
    for (const m of this.store.modules() as (Module & {
      contract?: ModuleContract;
    })[])
      if (m.enabled && m.contract?.dependencies.some((d) => d.module === id))
        throw Error("Disable dependent module first: " + m.id);
  }
  list() {
    this.installations = this.readState();
    return structuredClone(this.installations);
  }
  install(path: string) {
    this.installations = this.readState();
    const loaded = this.load(path),
      id = loaded.manifest.module.id;
    const previous = this.installations.find((p) => p.id === id);
    if (previous && previous.state !== "uninstalled")
      throw Error("Plugin already installed");
    const p: PluginInstallation = {
      id,
      ...loaded,
      state: "installed",
      authorized: false,
      grants: [],
      trustedLocalCode: false,
      acknowledgeUnsandboxedNetwork: false,
      events: previous?.events ?? [],
    };
    try {
      this.dependencies(loaded.manifest.module, false);
      const registered = this.store.modules().find((m) => m.id === id);
      if (registered) {
        if (
          json({ ...registered, enabled: false }) !==
          json({ ...loaded.manifest.module, enabled: false })
        )
          throw Error("Retained module differs; use upgrade");
        this.store.setEnabled(id, false);
      } else this.store.register({ ...loaded.manifest.module, enabled: false });
      if (previous)
        this.installations.splice(this.installations.indexOf(previous), 1, p);
      else this.installations.push(p);
      this.event(p, "install", true);
      return structuredClone(p);
    } catch (error) {
      // Failed valid manifests remain visible and retryable, without granting execution.
      p.state = "uninstalled";
      if (previous) this.event(previous, "install", false, error);
      else {
        this.installations.push(p);
        this.event(p, "install", false, error);
      }
      throw error;
    }
  }
  authorize(id: string, authorization: PluginAuthorization = {}) {
    return this.guard(id, "authorize", (p) => {
      this.notRunning(id);
      const permissions = p.manifest.module.contract.permissions;
      const grants =
        authorization.permissions ??
        permissions
          .filter((g) => ["read", "suggest"].includes(g.action))
          .map((g) => g.id);
      if (
        !Array.isArray(grants) ||
        new Set(grants).size !== grants.length ||
        grants.some(
          (g) => !permissions.some((permission) => permission.id === g),
        )
      )
        throw Error("Unknown or duplicate authorization permission");
      if (
        authorization.trustLocalCode &&
        !authorization.acknowledgeUnsandboxedNetwork
      )
        throw Error(
          "Explicit acknowledgement of unsandboxed network/system calls is required",
        );
      if (
        p.entryPath &&
        digest(readFileSync(this.externalFile(p.entryPath))) !== p.entryHash
      )
        throw Error("Plugin code changed; upgrade and reauthorize");
      this.store.setEnabled(id, false);
      p.state = "disabled";
      p.grants = [...grants];
      p.authorized = true;
      p.trustedLocalCode = authorization.trustLocalCode === true;
      p.acknowledgeUnsandboxedNetwork =
        authorization.acknowledgeUnsandboxedNetwork === true;
      return structuredClone(p);
    });
  }
  enable(id: string) {
    return this.guard(id, "enable", (p) => {
      this.notRunning(id);
      if (!p.authorized)
        throw Error("Explicit authorization required before enabling plugin");
      this.dependencies(p.manifest.module, true);
      this.store.setEnabled(id, true);
      p.state = "enabled";
      return structuredClone(p);
    });
  }
  disable(id: string) {
    return this.guard(id, "disable", (p) => {
      this.notRunning(id);
      this.noEnabledDependents(id);
      this.store.setEnabled(id, false);
      p.state = "disabled";
      return structuredClone(p);
    });
  }
  uninstall(id: string) {
    return this.guard(id, "uninstall", (p) => {
      this.notRunning(id);
      this.noEnabledDependents(id);
      this.store.setEnabled(id, false);
      p.state = "uninstalled";
      p.authorized = false;
      p.grants = [];
      p.trustedLocalCode = false;
      p.acknowledgeUnsandboxedNetwork = false;
      return { id, dataPreserved: true };
    });
  }
  upgrade(path: string) {
    const loaded = this.load(path),
      id = loaded.manifest.module.id;
    return this.guard(id, "upgrade", (p) => {
      this.notRunning(id);
      const old = this.store.module(id, false),
        next = loaded.manifest.module;
      if (compareVersions(next.version, old.version) <= 0)
        throw Error("Upgrade must increase module version");
      this.dependencies(next, false);
      let backup: string | undefined;
      if (next.schemaVersion !== old.schemaVersion) {
        const migration = next.contract.migrations?.find(
          (m) =>
            m.fromSchema === old.schemaVersion &&
            m.toSchema === next.schemaVersion,
        );
        if (!migration)
          throw Error("Upgrade requires declared one-step schema migration");
        backup = this.store.migrateModule(
          { ...next, enabled: true },
          migration.renames,
        ).backup;
      } else {
        if (
          json([old.entityTypes, old.relations]) !==
          json([next.entityTypes, next.relations])
        )
          throw Error("Schema changes require schema version migration");
        this.store.db
          .prepare("UPDATE modules SET json=? WHERE id=?")
          .run(json({ ...next, enabled: false }), id);
      }
      this.store.setEnabled(id, false);
      Object.assign(p, loaded, {
        state: "disabled",
        authorized: false,
        grants: [],
        trustedLocalCode: false,
        acknowledgeUnsandboxedNetwork: false,
      });
      if (!loaded.entryPath) {
        delete p.entryPath;
        delete p.entryHash;
      }
      return { id, ...(backup ? { backup } : {}), authorizationRequired: true };
    });
  }
  private permission(
    p: PluginInstallation,
    operation: ModuleOperation,
    id: string,
    action: ModulePermission["action"],
  ) {
    if (!operation.permissions.includes(id) || !p.grants.includes(id))
      throw Error("Plugin permission denied: " + id);
    const permission = p.manifest.module.contract.permissions.find(
      (g) => g.id === id,
    );
    if (!permission || permission.action !== action)
      throw Error("Plugin permission action mismatch");
    if (action === "external")
      throw Error("External execution disabled by local policy");
    this.store.module(permission.module);
    return permission;
  }
  private assertCurrent(p: PluginInstallation) {
    const current = this.readState().find((candidate) => candidate.id === p.id);
    const authorization = (value: PluginInstallation) => [
      value.state,
      value.authorized,
      value.grants,
      value.manifest,
      value.entryPath,
      value.entryHash,
      value.trustedLocalCode,
      value.acknowledgeUnsandboxedNetwork,
    ];
    if (!current || json(authorization(current)) !== json(authorization(p)))
      throw Error("Plugin authorization changed during operation");
    if (current.state !== "enabled" || !this.store.module(p.id).enabled)
      throw Error("Plugin disabled during operation");
  }
  private project(entity: Entity, permission: ModulePermission) {
    return {
      id: entity.id,
      module: entity.module,
      type: entity.type,
      title: entity.title,
      kind: entity.kind,
      status: entity.status,
      occurredAt: entity.occurredAt,
      timeZone: entity.timeZone,
      version: entity.version,
      fields: Object.fromEntries(
        Object.entries(entity.fields).filter(
          ([key]) => !permission.fields || permission.fields.includes(key),
        ),
      ),
    };
  }
  private broker(
    p: PluginInstallation,
    operation: ModuleOperation,
    call: {
      permission: string;
      action: "list" | "save" | "patch-fields" | "external";
      input?: unknown;
    },
    pending: PendingWrite[],
  ) {
    this.assertCurrent(p);
    const declared = p.manifest.module.contract.permissions.find(
      (g) => g.id === call.permission,
    );
    const action =
      call.action === "list"
        ? "read"
        : call.action === "save"
          ? declared?.action
          : call.action === "patch-fields"
            ? "write"
            : "external";
    if (
      !action ||
      (call.action === "save" && !["suggest", "write"].includes(action)) ||
      !["list", "save", "patch-fields", "external"].includes(call.action)
    )
      throw Error("Invalid broker action");
    const permission = this.permission(p, operation, call.permission, action);
    const cap: Capability = {
      actor: "plugin:" + p.id,
      role: action === "write" ? "human" : "ai",
      read: [permission.module],
      suggest: action === "suggest" ? [permission.module] : [],
      write: action === "write" ? [permission.module] : [],
      scope: {
        [permission.module]: {
          ...(permission.entityTypes
            ? { entityTypes: permission.entityTypes }
            : {}),
          ...(permission.fields ? { fields: permission.fields } : {}),
          body: action !== "read",
          relations: false,
          metadata: ["title", "occurredAt", "timeZone"],
        },
      },
    };
    if (call.action === "list") {
      return this.store
        .list({ module: permission.module }, cap)
        .filter(
          (e) =>
            !permission.entityTypes || permission.entityTypes.includes(e.type),
        )
        .map((e) => this.project(e, permission));
    }
    if (pending.length >= 32) throw Error("Plugin write limit exceeded");
    let request = structuredClone(call.input) as SaveRequest;
    if (call.action === "patch-fields") {
      const patch = call.input as {
        id: string;
        fields: Entity["fields"];
        expectedVersion: number;
      };
      if (
        !patch ||
        typeof patch.id !== "string" ||
        !patch.fields ||
        typeof patch.fields !== "object" ||
        Array.isArray(patch.fields) ||
        (permission.fields &&
          Object.keys(patch.fields).some(
            (key) => !permission.fields!.includes(key),
          ))
      )
        throw Error("Plugin field patch permission denied");
      const current = this.store.raw(patch.id);
      if (
        !current ||
        current.module !== permission.module ||
        (permission.entityTypes &&
          !permission.entityTypes.includes(current.type))
      )
        throw Error("Plugin entity permission denied");
      const snapshot = this.store.snapshot(patch.id)!;
      // Preserve existing links during a field patch without exposing their
      // targets to plugin code. The Store rechecks link permission on every save.
      for (const relation of snapshot.relations) {
        const target = this.store.raw(relation.target);
        if (target && target.module !== permission.module) {
          if (!cap.read.includes(target.module)) cap.read.push(target.module);
          const selection = (cap.scope![target.module] ??= {
            entityIds: [],
            fields: [],
            body: false,
            relations: false,
            metadata: [],
          });
          if (!selection.entityIds!.includes(target.id))
            selection.entityIds!.push(target.id);
        }
      }
      request = {
        entity: {
          ...snapshot,
          fields: { ...snapshot.fields, ...patch.fields },
        },
        expectedVersion: patch.expectedVersion,
        expectedNoteHash: digest(snapshot.markdown),
      };
    }
    if (
      !request?.entity ||
      request.entity.module !== permission.module ||
      (permission.entityTypes &&
        !permission.entityTypes.includes(request.entity.type)) ||
      !request.entity.fields ||
      (call.action !== "patch-fields" &&
        permission.fields &&
        Object.keys(request.entity.fields).some(
          (key) => !permission.fields!.includes(key),
        ))
    )
      throw Error("Plugin entity or field permission denied");
    if (call.action !== "patch-fields" && request.entity.relations?.length)
      throw Error(
        "Plugin relation writes require separate supported authorization; denied",
      );
    if (
      action === "suggest" &&
      (request.expectedVersion !== 0 ||
        request.entity.kind !== "inference" ||
        request.entity.status !== "draft")
    )
      throw Error("Plugin suggestions must be new draft inferences");
    // Restrict updates to rows whose entire field set is authorized; omission cannot delete hidden fields.
    if (
      call.action !== "patch-fields" &&
      request.expectedVersion > 0 &&
      request.entity.id
    ) {
      // The broker checks the full stored field set internally, never returning it.
      const existing = this.store.raw(request.entity.id);
      if (
        !existing ||
        existing.module !== permission.module ||
        (permission.entityTypes &&
          !permission.entityTypes.includes(existing.type)) ||
        (permission.fields &&
          Object.keys(existing.fields).some(
            (key) => !permission.fields!.includes(key),
          ))
      )
        throw Error("Plugin update exceeds field scope");
    }
    request.entity.id ??= randomUUID();
    if (pending.some((w) => w.request.entity.id === request.entity.id))
      throw Error("Repeated entity in plugin write batch");
    const preview = this.store.build(request, cap).value;
    pending.push({ request, capability: cap });
    return {
      ...this.project(preview as unknown as Entity, permission),
      pending: true,
    };
  }
  private commit(pending: PendingWrite[]) {
    if (!pending.length) return;
    this.store.flushNotes();
    this.store.transaction(() => {
      for (const write of pending)
        this.store.saveInTransaction(write.request, write.capability);
    });
  }
  async invoke(id: string, operationId: string, input: unknown = {}) {
    const p = this.installation(id);
    let acquired = false;
    try {
      this.notRunning(id);
      if (
        p.state !== "enabled" ||
        !p.authorized ||
        !this.store.module(id).enabled
      )
        throw Error("Plugin disabled or unauthorized");
      this.dependencies(p.manifest.module, true);
      const operation = p.manifest.module.contract.operations.find(
        (o) => o.id === operationId,
      );
      if (!operation) throw Error("Unknown plugin operation");
      this.active.add(id);
      acquired = true;
      const pending: PendingWrite[] = [];
      let result: unknown;
      if (operation.handler === "stdio") {
        if (!p.trustedLocalCode || !p.acknowledgeUnsandboxedNetwork)
          throw Error(
            "Trusted local code and unsandboxed network acknowledgement required",
          );
        result = await this.run(p, operation, input, pending);
      } else {
        const action =
          operation.handler === "list"
            ? "read"
            : operation.handler === "patch"
              ? "write"
              : operation.handler;
        const permission = operation.permissions.find(
          (id) =>
            p.manifest.module.contract.permissions.find((g) => g.id === id)
              ?.action === action,
        )!;
        result = this.broker(
          p,
          operation,
          {
            permission,
            action:
              operation.handler === "list"
                ? "list"
                : operation.handler === "external"
                  ? "external"
                  : operation.handler === "patch"
                    ? "patch-fields"
                    : "save",
            input,
          },
          pending,
        );
      }
      this.assertCurrent(p);
      this.dependencies(p.manifest.module, true);
      this.commit(pending);
      this.event(p, "invoke:" + operationId, true);
      if (
        operation.handler !== "stdio" &&
        pending.length &&
        result &&
        typeof result === "object"
      )
        return { ...result, pending: false };
      return result;
    } catch (error) {
      this.event(p, "invoke:" + operationId, false, error);
      throw error;
    } finally {
      if (acquired) this.active.delete(id);
    }
  }
  async import(id: string, importerId: string, text: string) {
    const p = this.installation(id);
    const importer = p.manifest.module.contract.importers.find(
      (i) => i.id === importerId,
    );
    if (
      !importer ||
      typeof text !== "string" ||
      Buffer.byteLength(text) > 1024 * 1024
    ) {
      const error = Error("Invalid plugin importer or input size");
      this.event(p, "import:" + importerId, false, error);
      throw error;
    }
    let input: unknown;
    try {
      input = importer.format === "json" ? JSON.parse(text) : text;
    } catch (error) {
      this.event(p, "import:" + importerId, false, error);
      throw error;
    }
    return this.invoke(id, importer.operation, input);
  }
  private async run(
    p: PluginInstallation,
    operation: ModuleOperation,
    input: unknown,
    pending: PendingWrite[],
  ) {
    if (process.versions.node.split(".")[0] !== "24")
      throw Error("Plugin runner requires supported Node 24 permission model");
    if (!p.entryPath) throw Error("Missing plugin entry");
    const code = readFileSync(this.externalFile(p.entryPath));
    if (digest(code) !== p.entryHash)
      throw Error("Plugin code changed; upgrade and reauthorize");
    const directory = mkdtempSync(join(tmpdir(), "life-plugin-run-"));
    const entry = join(directory, "plugin.mjs");
    writeFileSync(entry, code, { mode: 0o600, flag: "wx" });
    const payload = json({
      protocol: 1,
      type: "invoke",
      operation: operation.id,
      input,
    });
    if (Buffer.byteLength(payload) > 1024 * 1024) {
      rmSync(directory, { recursive: true, force: true });
      throw Error("Plugin input exceeds size limit");
    }
    try {
      return await new Promise<unknown>((resolveResult, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--permission",
            "--allow-fs-read=" + entry,
            "--no-addons",
            "--disable-proto=throw",
            "--max-old-space-size=64",
            entry,
          ],
          {
            cwd: directory,
            env: { LANG: "C.UTF-8", TZ: "UTC" },
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
          },
        );
        let buffer = "",
          bytes = 0,
          result: unknown,
          returned = false,
          settled = false;
        const usedIds = new Set<string>();
        const fail = (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          child.kill("SIGKILL");
          reject(error);
        };
        const timer = setTimeout(
          () => fail(Error("Plugin execution timed out")),
          this.options.timeoutMs ?? 3000,
        );
        const consume = (chunk: Buffer | string) => {
          bytes +=
            typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
          if (bytes > (this.options.maxOutputBytes ?? 1024 * 1024)) {
            fail(Error("Plugin output limit exceeded"));
            return false;
          }
          return true;
        };
        child.on("error", fail);
        child.stdin.on("error", (error) => {
          if (!returned) fail(error);
        });
        child.stderr.on("data", (chunk: Buffer) => {
          consume(chunk);
        });
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          if (settled || !consume(chunk)) return;
          buffer += chunk;
          while (buffer.includes("\n")) {
            const index = buffer.indexOf("\n"),
              line = buffer.slice(0, index);
            buffer = buffer.slice(index + 1);
            try {
              const value = JSON.parse(line);
              if (value.protocol !== 1 || returned)
                throw Error("Invalid plugin stdio protocol");
              if (value.type === "result") {
                result = value.value;
                returned = true;
                child.stdin.end();
              } else if (
                value.type === "call" &&
                typeof value.id === "string" &&
                /^[a-zA-Z0-9-]{1,64}$/.test(value.id) &&
                !usedIds.has(value.id) &&
                usedIds.size < 64
              ) {
                usedIds.add(value.id);
                const output = this.broker(p, operation, value, pending);
                child.stdin.write(
                  json({
                    protocol: 1,
                    type: "response",
                    id: value.id,
                    value: output,
                  }) + "\n",
                );
              } else throw Error("Invalid plugin stdio call");
            } catch (error) {
              fail(error);
              return;
            }
          }
        });
        child.on("close", (code, signal) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (code !== 0 || signal || !returned || buffer.trim())
            reject(
              Error(
                "Plugin failed or returned incomplete protocol (exit " +
                  code +
                  ")",
              ),
            );
          else resolveResult(result);
        });
        child.stdin.write(payload + "\n");
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}
