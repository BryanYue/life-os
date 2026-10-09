import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { normalizedScope, validateEntityScope } from "./permissions.js";
import { outsideRepository } from "./paths.js";
import { assertRunnableWorkspace } from "./workspace-copy.js";
import type { EntityScope, SyncScope } from "./types.js";

export type LocalConfig = {
  agentToken?: string;
  agentModules?: string[];
  agentScope?: Record<string, EntityScope>;
  syncModules?: string[];
  syncScope?: SyncScope;
};
const keys = [
  "agentToken",
  "agentModules",
  "agentScope",
  "syncModules",
  "syncScope",
] as const;
const maxBytes = 256_000;

// Messages are fixed strings: config.json holds the agent token and private
// entity ids, so validation must never echo a value back to logs or stderr.
const invalid = (reason: string) => Error("Invalid config.json: " + reason);
const strings = (value: unknown) =>
  Array.isArray(value) && value.every((v) => typeof v === "string");

export function validateLocalConfig(value: unknown): LocalConfig {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid("top level must be an object");
  const config = value as Record<string, unknown>;
  if (Object.keys(config).some((k) => !(keys as readonly string[]).includes(k)))
    throw invalid("unknown top-level key (allowed: " + keys.join(", ") + ")");
  if (config.agentToken !== undefined && typeof config.agentToken !== "string")
    throw invalid("agentToken must be a string");
  for (const k of ["agentModules", "syncModules"] as const)
    if (config[k] !== undefined && !strings(config[k]))
      throw invalid(k + " must be an array of module ids");
  try {
    if (config.agentScope !== undefined) {
      const scope = config.agentScope;
      if (!scope || typeof scope !== "object" || Array.isArray(scope))
        throw Error("Invalid entity scope");
      for (const s of Object.values(scope)) validateEntityScope(s);
    }
    const sync = config.syncScope;
    if (sync !== undefined) {
      // normalizedScope ignores unknown container keys and falsy entities,
      // both of which silently turn a selection into a whole-module grant.
      if (
        sync &&
        typeof sync === "object" &&
        !Array.isArray(sync) &&
        (Object.keys(sync).some((k) => k !== "modules" && k !== "entities") ||
          ("entities" in sync &&
            (!sync.entities ||
              typeof sync.entities !== "object" ||
              Array.isArray(sync.entities))))
      )
        throw Error("Invalid sync scope container");
      normalizedScope(sync as SyncScope);
    }
  } catch (error) {
    throw invalid((error as Error).message);
  }
  return config as LocalConfig;
}

export function loadLocalConfig(root: string): LocalConfig {
  let fd: number;
  try {
    fd = openSync(
      join(root, "config.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return {};
    if (code === "ELOOP")
      throw invalid("must be a regular file; symlink denied");
    throw invalid("could not be opened (" + code + ")");
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw invalid("must be a regular file");
    if (stat.size > maxBytes) throw invalid("file is too large");
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(fd, "utf8"));
    } catch {
      throw invalid("not valid JSON");
    }
    return validateLocalConfig(parsed);
  } finally {
    closeSync(fd);
  }
}

export function syncGrant(config: LocalConfig): string[] | SyncScope {
  return config.syncScope ?? config.syncModules ?? [];
}

export function redactedConfig(config: LocalConfig) {
  const { agentToken, ...rest } = config;
  return agentToken === undefined
    ? rest
    : { agentToken: "<redacted>", ...rest };
}

// Creates only root/config.json (and root itself when absent). Publishing via
// link() refuses to replace an existing file, so a concurrent writer or an
// existing hand-written config is never overwritten.
export function initLocalConfig(
  root: string,
  options: { agentToken?: boolean } = {},
) {
  root = outsideRepository(root);
  assertRunnableWorkspace(root);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (!lstatSync(root).isDirectory())
    throw Error("Private data root must be a directory; symlink denied");
  const config: LocalConfig = {
    ...(options.agentToken
      ? { agentToken: randomBytes(32).toString("hex") }
      : {}),
    agentModules: [],
    syncModules: [],
  };
  const target = join(root, "config.json");
  const temporary = join(
    root,
    ".config-" + randomBytes(8).toString("hex") + ".tmp",
  );
  const fd = openSync(
    temporary,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    try {
      writeSync(fd, JSON.stringify(config, null, 2) + "\n");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      linkSync(temporary, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw Error("config.json already exists; it was not overwritten");
      throw error;
    }
  } finally {
    unlinkSync(temporary);
  }
  return redactedConfig(config);
}
