import { createHash } from "node:crypto";
import { constants, lstatSync, readFileSync, type BigIntStats } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { outsideRepository } from "./paths.js";

export const WORKSPACE_COPY_MARKER = "workspace-copy.json";
const ARCHIVE_DIRECTORY = "archive";
export type WorkspaceCopyOptions = {
  /** The operator has stopped every writer, including external note editors. */
  offlineConfirmed: true;
  signal?: AbortSignal;
};
export type WorkspaceCopyResult = {
  kind: "preservation-only";
  runnable: false;
  targetDirectory: string;
  archiveDirectory: string;
  fileCount: number;
  directoryCount: number;
  totalBytes: string;
  pluginAuthorization: "archived-requires-fresh-authorization";
};
type Entry = {
  kind: "file" | "directory";
  identity: string;
  size: bigint;
  sha256?: string;
};
type Inventory = Map<string, Entry>;
class WorkspaceCopyError extends Error {}
function fail(message: string): never {
  throw new WorkspaceCopyError(message);
}
function interrupted(signal?: AbortSignal) {
  if (signal?.aborted) fail("Workspace preservation interrupted");
}
const identity = (stat: BigIntStats) =>
  [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].join(
    ":",
  );
const inside = (root: string, path: string) => {
  const part = relative(root, path);
  return (
    part === "" ||
    (part !== ".." &&
      !part.startsWith(".." + (process.platform === "win32" ? "\\" : "/")) &&
      !isAbsolute(part))
  );
};
async function absent(path: string) {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  fail("Workspace preservation requires a new destination");
}
async function plainDirectoryPath(path: string) {
  let current = path;
  for (;;) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      fail("Workspace paths must be directories without symbolic links");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
async function transferFile(
  path: string,
  signal?: AbortSignal,
  destination?: string,
  expected?: Entry,
): Promise<Entry> {
  interrupted(signal);
  // O_NONBLOCK prevents a substituted FIFO from blocking before fstat rejects it.
  const input = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let output: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const before = await input.stat({ bigint: true });
    if (!before.isFile())
      fail("Workspace contains a symbolic link or special file");
    if (expected && identity(before) !== expected.identity)
      fail("Workspace changed during preservation; stop all writers and retry");
    if (destination) {
      output = await open(destination, "wx", 0o600);
      await output.chmod(0o600);
    }
    const digest = createHash("sha256"),
      buffer = Buffer.alloc(64 * 1024);
    let bytes = 0n;
    for (;;) {
      interrupted(signal);
      const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      digest.update(buffer.subarray(0, bytesRead));
      bytes += BigInt(bytesRead);
      if (output) {
        let offset = 0;
        while (offset < bytesRead) {
          interrupted(signal);
          const written = await output.write(
            buffer,
            offset,
            bytesRead - offset,
            null,
          );
          if (!written.bytesWritten)
            fail("Workspace file copy could not complete");
          offset += written.bytesWritten;
        }
      }
    }
    const after = await input.stat({ bigint: true }),
      current = await lstat(path, { bigint: true });
    if (
      identity(before) !== identity(after) ||
      identity(before) !== identity(current) ||
      bytes !== before.size
    )
      fail("Workspace changed during preservation; stop all writers and retry");
    const sha256 = digest.digest("hex");
    if (expected && sha256 !== expected.sha256)
      fail("Workspace changed during preservation; stop all writers and retry");
    await output?.sync();
    return { kind: "file", identity: identity(before), size: bytes, sha256 };
  } finally {
    try {
      await output?.close();
    } finally {
      await input.close();
    }
  }
}
async function inventory(
  root: string,
  signal?: AbortSignal,
): Promise<Inventory> {
  const entries: Inventory = new Map();
  async function visit(part: string) {
    interrupted(signal);
    const path = join(root, part),
      stat = await lstat(path, { bigint: true });
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
      fail("Workspace contains a symbolic link or special file");
    if (stat.isDirectory()) {
      entries.set(part, {
        kind: "directory",
        identity: identity(stat),
        size: 0n,
      });
      for (const name of (await readdir(path)).sort())
        await visit(join(part, name));
      if (identity(stat) !== identity(await lstat(path, { bigint: true })))
        fail(
          "Workspace changed during preservation; stop all writers and retry",
        );
    } else {
      // A byte-for-byte SQLite copy must never claim to capture an active WAL.
      if (part.endsWith("-wal") && stat.size > 0n)
        fail(
          "Workspace has a nonempty WAL; stop services and checkpoint or close the database before retrying",
        );
      entries.set(part, await transferFile(path, signal));
    }
  }
  await visit("");
  return entries;
}
function unchanged(before: Inventory, after: Inventory) {
  if (before.size !== after.size) return false;
  for (const [path, entry] of before) {
    const next = after.get(path);
    if (
      !next ||
      entry.kind !== next.kind ||
      entry.identity !== next.identity ||
      entry.sha256 !== next.sha256
    )
      return false;
  }
  return true;
}

/** This does not prove that a writer is stopped: the explicit offline confirmation
 * is mandatory. Hash comparisons only detect changes observed during copying.
 * No database, module manifest, configuration or plugin code is interpreted. */
export async function prepareWorkspaceCopy(
  source: string,
  target: string,
  options: WorkspaceCopyOptions,
): Promise<WorkspaceCopyResult> {
  let staging: string | undefined, reservation: BigIntStats | undefined;
  let published = false;
  try {
    if (options?.offlineConfirmed !== true)
      fail(
        "Confirm that all source writers are stopped before preserving a workspace",
      );
    interrupted(options.signal);
    source = resolve(source);
    target = resolve(target);
    outsideRepository(source);
    outsideRepository(target);
    await plainDirectoryPath(source);
    await plainDirectoryPath(dirname(target));
    source = await realpath(source);
    target = join(await realpath(dirname(target)), basename(target));
    if (inside(source, target) || inside(target, source))
      fail("Source and destination paths must not overlap");
    await absent(target);
    const before = await inventory(source, options.signal);
    staging = await mkdtemp(join(dirname(target), ".life-preserve-"));
    await chmod(staging, 0o700);
    const archive = join(staging, ARCHIVE_DIRECTORY);
    let fileCount = 0,
      directoryCount = 0,
      totalBytes = 0n;
    for (const [part, entry] of before) {
      interrupted(options.signal);
      const destination = join(archive, part);
      if (entry.kind === "directory") {
        await mkdir(destination, { mode: 0o700 });
        await chmod(destination, 0o700);
        directoryCount++;
      } else {
        await transferFile(
          join(source, part),
          options.signal,
          destination,
          entry,
        );
        fileCount++;
        totalBytes += entry.size;
      }
    }
    await plainDirectoryPath(source);
    if (!unchanged(before, await inventory(source, options.signal)))
      fail("Workspace changed during preservation; stop all writers and retry");
    const marker = {
      format: 1,
      kind: "preservation-only",
      runnable: false,
      archiveDirectory: ARCHIVE_DIRECTORY,
      fileCount,
      directoryCount,
      totalBytes: String(totalBytes),
      pluginAuthorization: "archived-requires-fresh-authorization",
      instruction:
        "Do not run this package or archive with any version of Life OS. Create a separately reviewed isolated restore candidate; plugin execution requires fresh authorization.",
    };
    await writeFile(
      join(staging, WORKSPACE_COPY_MARKER),
      JSON.stringify(marker) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    interrupted(options.signal);
    await plainDirectoryPath(dirname(target));
    // Exclusive mkdir reserves only a new destination. Never rename over an
    // existing user directory; check the reservation again immediately before publish.
    await mkdir(target, { mode: 0o700 });
    reservation = await lstat(target, { bigint: true });
    const current = await lstat(target, { bigint: true });
    if (
      identity(reservation) !== identity(current) ||
      (await readdir(target)).length
    )
      fail("Workspace destination changed before publication");
    interrupted(options.signal);
    await rename(staging, target);
    published = true;
    return {
      kind: "preservation-only",
      runnable: false,
      targetDirectory: target,
      archiveDirectory: join(target, ARCHIVE_DIRECTORY),
      fileCount,
      directoryCount,
      totalBytes: String(totalBytes),
      pluginAuthorization: "archived-requires-fresh-authorization",
    };
  } catch (error) {
    if (error instanceof WorkspaceCopyError) throw error;
    // OS error strings may include private file paths. Do not expose them to CLI output.
    throw new WorkspaceCopyError(
      "Workspace preservation failed; no completed copy was published",
    );
  } finally {
    let cleanupFailed = false;
    if (!published && staging) {
      try {
        await rm(staging, { recursive: true, force: true });
      } catch {
        cleanupFailed = true;
      }
    }
    if (!published && reservation) {
      try {
        const stat = await lstat(target, { bigint: true });
        if (
          stat.dev === reservation.dev &&
          stat.ino === reservation.ino &&
          stat.isDirectory()
        )
          await rmdir(target);
      } catch {
        // Never remove another writer's replacement or populated destination.
      }
    }
    if (cleanupFailed)
      fail(
        "Workspace preservation failed; private staging cleanup requires manual attention",
      );
  }
}

/** Apply before opening a Store. Older Life OS versions cannot recognize this
 * marker, so operators must still never start them against the archive. */
export function assertRunnableWorkspace(root: string): void {
  let path = resolve(root);
  for (;;) {
    const marker = join(path, WORKSPACE_COPY_MARKER);
    let present = false;
    try {
      const stat = lstatSync(marker);
      present = true;
      if (!stat.isFile() || stat.isSymbolicLink())
        fail("Workspace preservation marker is invalid; direct startup denied");
      const data = JSON.parse(readFileSync(marker, "utf8"));
      if (data?.kind === "preservation-only" || data?.runnable === false)
        fail(
          "This workspace is a preservation-only archive; direct startup is forbidden",
        );
    } catch (error) {
      if (error instanceof WorkspaceCopyError) throw error;
      if (present || (error as NodeJS.ErrnoException).code !== "ENOENT")
        fail(
          "Workspace preservation marker could not be verified; direct startup denied",
        );
    }
    const parent = dirname(path);
    if (path === parent) return;
    path = parent;
  }
}
