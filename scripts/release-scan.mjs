import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const failures = [];
const scan = (name, data) => {
  if (
    /\.(sqlite(?:-wal|-shm)?|db|p12|pfx|pem|key|bundle|zip)$/i.test(name) ||
    /(^|\/)(\.env(?:\.|$)|config\.json$|vault\/|backups\/)/.test(name)
  )
    failures.push(name + ": private file type/path");
  const text = data.toString("utf8");
  const credentials = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9]{30,}/,
    /\bgithub_pat_[A-Za-z0-9_]{40,}/,
    /\bAKIA[A-Z0-9]{16}\b/,
    /\bsk-[A-Za-z0-9]{40,}/,
  ];
  if (credentials.some((re) => re.test(text)))
    failures.push(name + ": credential-like content");
  if (/"payload"\s*:\s*".*\\"tables\\"/.test(text))
    failures.push(name + ": backup payload");
  const emails =
    text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];
  if (
    emails.some(
      (e) =>
        !e.endsWith("@users.noreply.github.com") &&
        !e.endsWith("@example.invalid"),
    )
  )
    failures.push(name + ": non-example email");
};
const files = [
  ...new Set(
    git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
      .split("\0")
      .filter(Boolean),
  ),
];
for (const p of files) if (existsSync(p)) scan(p, readFileSync(p));
for (const file of git("ls-files", "-z").split("\0").filter(Boolean)) {
  scan("index:" + file, execFileSync("git", ["show", ":" + file]));
}
for (const commit of git("rev-list", "HEAD").split("\n").filter(Boolean)) {
  const emails = git("show", "-s", "--format=%ae%n%ce", commit).split("\n");
  if (emails.some((e) => !e.endsWith("@users.noreply.github.com")))
    failures.push(commit + ": non-noreply author/committer");
  for (const file of git("ls-tree", "-r", "--name-only", commit)
    .split("\n")
    .filter(Boolean))
    scan(
      commit + ":" + file,
      execFileSync("git", ["show", commit + ":" + file]),
    );
}
const scanBuild = (dir) => {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) scanBuild(p);
    else scan(p, readFileSync(p));
  }
};
scanBuild("web-dist");
if (failures.length) {
  console.error([...new Set(failures)].join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Scanned ${files.length} source files, reachable history metadata/content, and web-dist: no configured findings. Human review still required; patterns cannot prove absence of private data.`,
  );
