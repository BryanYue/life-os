import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

// Git identities and display labels must never become part of the policy path.
const git = (...args) => {
  try {
    return execFileSync("git", ["--no-replace-objects", ...args], {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw Error(`Git ${args[0]} failed; scan incomplete`);
  }
};
const failures = new Set();
const blobs = new Map();
const credentials = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bsk-[A-Za-z0-9_-]{40,}/,
];
// Concrete account home directories identify a person's machine; placeholders
// such as <user>, $HOME or ~ do not match the name character class.
const personalMachinePaths = [
  /(?:^|[^A-Za-z0-9_.-])\/(?:Users|home)\/[A-Za-z0-9_.-]+/m,
  /\b[A-Za-z]:(?:\\{1,2}|\/)(?:Users|Documents and Settings)(?:\\{1,2}|\/)[A-Za-z0-9_.-]+/,
];
function scan(path, scope, read) {
  const name = JSON.stringify(`${scope}:${path}`);
  if (
    /\.(sqlite(?:-wal|-shm)?|db|p12|pfx|pem|key|bundle|zip)$/i.test(path) ||
    /(^|\/)(\.env(?:\.|$)|(?:config|personal-profile|plugin-state|templates|workspace-copy)\.json$|vault\/|backups\/)/.test(
      path,
    )
  ) {
    failures.add(name + ": private file type/path");
    return; // Path rejection needs no access to private file contents.
  }
  const text = read();
  if (credentials.some((re) => re.test(text)))
    failures.add(name + ": credential-like content");
  if (personalMachinePaths.some((re) => re.test(text)))
    failures.add(name + ": personal machine path");
  if (/"payload"\s*:\s*".*\\"tables\\"/.test(text))
    failures.add(name + ": backup payload");
  const emails =
    text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];
  if (
    emails.some(
      (e) =>
        !e.endsWith("@users.noreply.github.com") &&
        !e.endsWith("@example.invalid"),
    )
  )
    failures.add(name + ": non-example email");
}
function blob(oid) {
  if (!blobs.has(oid)) blobs.set(oid, git("cat-file", "blob", oid));
  return blobs.get(oid);
}
function disk(path, scope) {
  // Check every ancestor before touching the leaf; lstat(leaf) alone follows
  // symlinked parent directories and can read outside the checkout.
  let parent = dirname(path);
  while (parent !== ".") {
    let ancestor;
    try {
      ancestor = lstatSync(parent);
    } catch (error) {
      if (scope === "worktree" && error.code === "ENOENT") return;
      throw Error("Cannot inspect path ancestor " + JSON.stringify(parent));
    }
    if (!ancestor.isDirectory() || ancestor.isSymbolicLink())
      throw Error("Unsupported path ancestor " + JSON.stringify(parent));
    parent = dirname(parent);
  }
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT" && scope === "worktree") return; // A tracked deletion is still scanned in the index/history.
    throw Error("Cannot inspect " + JSON.stringify(path));
  }
  if (!stat.isFile())
    throw Error("Unsupported file or symlink " + JSON.stringify(path));
  scan(path, scope, () => readFileSync(path, "utf8"));
}
function build(dir) {
  let stat;
  try {
    stat = lstatSync(dir);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw Error("Unsupported build directory");
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) build(path);
    else disk(path, "build");
  }
}
try {
  process.chdir(git("rev-parse", "--show-toplevel").trim());
  if (existsSync(git("rev-parse", "--git-path", "info/grafts").trim()))
    throw Error("Legacy grafts can hide reachable history; scan incomplete");
  if (git("rev-parse", "--is-shallow-repository").trim() !== "false")
    throw Error("Shallow history; fetch complete history before scanning");
  const files = [
    ...new Set(
      git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
        .split("\0")
        .filter(Boolean),
    ),
  ];
  for (const path of files) disk(path, "worktree");
  for (const record of git("ls-files", "--stage", "-z")
    .split("\0")
    .filter(Boolean)) {
    const tab = record.indexOf("\t");
    const [mode, oid, stage] = record.slice(0, tab).split(" ");
    if (stage !== "0" || !["100644", "100755"].includes(mode))
      throw Error("Unmerged or unsupported index entry");
    scan(record.slice(tab + 1), "index", () => blob(oid));
  }
  const commits = git("rev-list", "HEAD").trim().split("\n").filter(Boolean);
  for (const commit of commits) {
    const emails = git("show", "-s", "--format=%ae%n%ce", commit)
      .trim()
      .split("\n");
    if (emails.some((e) => !e.endsWith("@users.noreply.github.com")))
      failures.add(commit + ": non-noreply author/committer");
    scan("commit-message", commit, () =>
      git("show", "-s", "--format=%B", commit),
    );
    for (const record of git("ls-tree", "-r", "-z", commit)
      .split("\0")
      .filter(Boolean)) {
      const tab = record.indexOf("\t");
      const [mode, type, oid] = record.slice(0, tab).split(" ");
      if (type !== "blob" || !["100644", "100755"].includes(mode))
        throw Error("Unsupported history entry");
      scan(record.slice(tab + 1), commit, () => blob(oid));
    }
  }
  build("web-dist");
  if (failures.size) {
    console.error([...failures].join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      `Scanned ${files.length} worktree files, index, ${commits.length} HEAD-reachable commits/metadata, and optional web-dist: no configured findings. Ignored runtime data, other refs and external files are excluded; human review is still required.`,
    );
} catch (error) {
  if (failures.size) console.error([...failures].join("\n"));
  console.error("Release scan incomplete: " + error.message);
  process.exitCode = 2;
}
