import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const script =
  process.env.LIFE_OS_SCAN_SCRIPT ?? resolve("scripts/release-scan.mjs");
function fixture(
  run: (dir: string, git: (...args: string[]) => string) => void,
) {
  const dir = mkdtempSync(join(tmpdir(), "life-release-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    git("init", "-q");
    git("config", "user.name", "Synthetic Contributor");
    git("config", "user.email", "synthetic@users.noreply.github.com");
    writeFileSync(
      join(dir, "README.md"),
      "Synthetic public fixture contact: demo@example.invalid\n",
    );
    git("add", ".");
    git("commit", "-qm", "public fixture");
    run(dir, git);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
function scan(dir: string) {
  return spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8" });
}
for (const scope of ["worktree", "index", "history"]) {
  test(`release scan rejects private root path in ${scope}`, () =>
    fixture((dir, git) => {
      writeFileSync(join(dir, "personal-profile.json"), "{}");
      if (scope !== "worktree") {
        git("add", ".");
        rmSync(join(dir, "personal-profile.json"));
      }
      if (scope === "history") {
        git("commit", "-qm", "synthetic private path");
        git("add", "-u");
        git("commit", "-qm", "remove fixture");
      }
      const result = scan(dir);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /personal-profile\.json.*private file/);
    }));
}
test("release scan accepts public fixtures and filenames with whitespace/colon", () =>
  fixture((dir, git) => {
    mkdirSync(join(dir, "examples"));
    writeFileSync(join(dir, "examples", "profile-example.json"), "{}");
    writeFileSync(join(dir, "space\nname:public.txt"), "synthetic");
    git("add", ".");
    git("commit", "-qm", "public");
    assert.equal(scan(dir).status, 0);
  }));
test("release scan combines nested path, extension, content and build rules", () =>
  fixture((dir, git) => {
    mkdirSync(join(dir, "nested"));
    writeFileSync(join(dir, "nested", "config.json"), "{}");
    writeFileSync(join(dir, "synthetic.db"), "synthetic");
    writeFileSync(join(dir, "content.txt"), "gh" + "p_" + "a".repeat(36));
    git("add", ".");
    git("commit", "-qm", "synthetic findings");
    mkdirSync(join(dir, "web-dist"));
    writeFileSync(
      join(dir, "web-dist", "chunk.js"),
      "someone" + "@" + "synthetic.test",
    );
    const result = scan(dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /nested\/config.json/);
    assert.match(result.stderr, /synthetic.db/);
    assert.match(result.stderr, /credential-like/);
    assert.match(result.stderr, /web-dist/);
  }));
test("release scan accepts ordinary author and committer email metadata", () =>
  fixture((dir, git) => {
    git("config", "user.email", "someone" + "@" + "synthetic.test");
    git("commit", "--allow-empty", "-qm", "metadata");
    const result = scan(dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }));
test("release scan accepts a GitHub-style merge with human author and platform committer", () =>
  fixture((dir, git) => {
    const base = git("rev-parse", "HEAD");
    git("checkout", "-q", "-b", "side");
    git(
      "-c",
      "user.email=human" + "@" + "synthetic.test",
      "commit",
      "--allow-empty",
      "-qm",
      "side change",
    );
    const side = git("rev-parse", "HEAD");
    git("checkout", "-q", "-b", "target", base);
    git("commit", "--allow-empty", "-qm", "target change");
    const tree = git("rev-parse", "HEAD^{tree}");
    const merge = execFileSync(
      "git",
      [
        "commit-tree",
        tree,
        "-p",
        git("rev-parse", "HEAD"),
        "-p",
        side,
        "-m",
        "Merge side",
      ],
      {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Human",
          GIT_AUTHOR_EMAIL: "human" + "@" + "synthetic.test",
          GIT_COMMITTER_NAME: "GitHub",
          GIT_COMMITTER_EMAIL: "platform" + "@" + "synthetic.test",
        },
      },
    ).trim();
    git("reset", "-q", "--hard", merge);
    assert.equal(
      git("rev-list", "--parents", "-n1", "HEAD").split(" ").length,
      3,
    );
    const result = scan(dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }));
for (const scope of ["worktree", "index", "history", "message", "build"]) {
  test(`release scan still rejects a non-example email in ${scope} without echoing it`, () =>
    fixture((dir, git) => {
      const content = "contact someone" + "@" + "synthetic.test\n";
      if (scope === "message")
        git("commit", "--allow-empty", "-qm", "Synthetic " + content);
      else if (scope === "build") {
        mkdirSync(join(dir, "web-dist"));
        writeFileSync(join(dir, "web-dist", "chunk.js"), content);
      } else {
        writeFileSync(join(dir, "mail.md"), content);
        if (scope !== "worktree") {
          git("add", ".");
          if (scope === "history") {
            git("commit", "-qm", "synthetic email");
            git("rm", "-q", "mail.md");
            git("commit", "-qm", "remove email");
          } else writeFileSync(join(dir, "mail.md"), "safe worktree");
        }
      }
      const result = scan(dir);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /non-example email/);
      assert.doesNotMatch(result.stderr + result.stdout, /someone/);
    }));
}
test("release scan rejects incomplete history", () =>
  fixture((dir, git) => {
    writeFileSync(
      join(dir, ".git", "shallow"),
      git("rev-parse", "HEAD") + "\n",
    );
    const result = scan(dir);
    assert.equal(result.status, 2);
    assert.doesNotMatch(result.stdout, /no configured findings/);
  }));
test("release scan never follows symlinks to outside content", () =>
  fixture((dir) => {
    symlinkSync(
      "/definitely-not-readable-synthetic-target",
      join(dir, "public-link"),
    );
    const result = scan(dir);
    assert.equal(result.status, 2);
    assert.doesNotMatch(result.stdout, /no configured findings/);
  }));
test("release scan git errors cannot claim success", () => {
  const dir = mkdtempSync(join(tmpdir(), "life-not-git-"));
  try {
    const result = scan(dir);
    assert.equal(result.status, 2);
    assert.doesNotMatch(result.stdout, /no configured findings/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("release scan rejects symlinked ancestors even when the link is ignored", () =>
  fixture((dir, git) => {
    mkdirSync(join(dir, "nested"));
    writeFileSync(join(dir, "nested", "public.txt"), "synthetic");
    git("add", ".");
    git("commit", "-qm", "tracked child");
    const outside = mkdtempSync(join(tmpdir(), "life-outside-"));
    try {
      writeFileSync(join(outside, "public.txt"), "outside-synthetic");
      rmSync(join(dir, "nested"), { recursive: true });
      symlinkSync(outside, join(dir, "nested"));
      writeFileSync(join(dir, ".gitignore"), "nested\n");
      const result = scan(dir);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /ancestor/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  }));

test("release scan traverses original history despite replace refs", () =>
  fixture((dir, git) => {
    writeFileSync(join(dir, "personal-profile.json"), "{}");
    git("add", ".");
    git("commit", "-qm", "synthetic private path");
    git("rm", "personal-profile.json");
    git("commit", "-qm", "remove path");
    git("replace", "--graft", "HEAD");
    const result = scan(dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /personal-profile/);
  }));
test("release scan rejects legacy grafts rather than reporting full history", () =>
  fixture((dir, git) => {
    writeFileSync(
      join(dir, ".git", "info", "grafts"),
      git("rev-parse", "HEAD") + "\n",
    );
    const result = scan(dir);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /grafts/);
  }));
test("release scan accepts tracked deletions with missing parent directories", () =>
  fixture((dir, git) => {
    mkdirSync(join(dir, "nested"));
    writeFileSync(join(dir, "nested", "public.txt"), "synthetic");
    git("add", ".");
    git("commit", "-qm", "public nested");
    rmSync(join(dir, "nested"), { recursive: true });
    assert.equal(scan(dir).status, 0);
  }));

for (const scope of ["index", "history", "message"]) {
  test(`review regression: release scan detects content only in ${scope}`, () =>
    fixture((dir, git) => {
      const content = "gh" + "p_" + "a".repeat(36);
      if (scope === "message")
        git("commit", "--allow-empty", "-qm", "Synthetic token " + content);
      else {
        writeFileSync(join(dir, "content-only.txt"), content);
        git("add", ".");
        if (scope === "history") {
          git("commit", "-qm", "synthetic content");
          git("rm", "content-only.txt");
          git("commit", "-qm", "remove synthetic content");
        } else writeFileSync(join(dir, "content-only.txt"), "safe worktree");
      }
      const result = scan(dir);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /credential-like/);
      assert.doesNotMatch(result.stderr, new RegExp(content));
    }));
}
for (const prefix of ["sk" + "-proj-", "sk" + "-ant-api03-"]) {
  test(`review regression: release scan detects hyphenated key prefix ${prefix}`, () =>
    fixture((dir) => {
      writeFileSync(join(dir, "synthetic-token.txt"), prefix + "a".repeat(48));
      const result = scan(dir);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /credential-like/);
    }));
}
test("review regression: release scan accepts a non-noreply committer with a noreply author", () =>
  fixture((dir, git) => {
    git(
      "-c",
      "user.email=committer" + "@" + "example.test",
      "commit",
      "--allow-empty",
      "--author=Synthetic <synthetic@users.noreply.github.com>",
      "-qm",
      "committer fixture",
    );
    const result = scan(dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }));
for (const mode of ["120000", "160000"]) {
  test(`review regression: release scan refuses index mode ${mode}`, () =>
    fixture((dir, git) => {
      const oid =
        mode === "120000"
          ? git("rev-parse", "HEAD:README.md")
          : git("rev-parse", "HEAD");
      git("update-index", "--add", "--cacheinfo", `${mode},${oid},unsupported`);
      const result = scan(dir);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /unsupported index/i);
    }));
}
test("review regression: release scan refuses history symlinks removed from the current index", () =>
  fixture((dir, git) => {
    const oid = git("rev-parse", "HEAD:README.md");
    git("update-index", "--add", "--cacheinfo", `120000,${oid},old-link`);
    git("commit", "-qm", "synthetic history link");
    git("update-index", "--force-remove", "old-link");
    git("commit", "-qm", "remove link");
    const result = scan(dir);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Unsupported history entry/);
  }));
const syntheticUser = "fixture" + "person";
const personalPaths = [
  ["", "Users", syntheticUser, "notes"].join("/"),
  ["", "home", syntheticUser, ".life-os"].join("/"),
  ["C:", "Users", syntheticUser, "vault"].join("\\"),
];
for (const scope of ["worktree", "index", "history", "message", "build"]) {
  test(`release scan detects a personal machine path in ${scope} without echoing it`, () =>
    fixture((dir, git) => {
      const content = "Evidence at " + personalPaths[0] + "\n";
      if (scope === "message")
        git("commit", "--allow-empty", "-qm", "Synthetic " + content);
      else if (scope === "build") {
        mkdirSync(join(dir, "web-dist"));
        writeFileSync(join(dir, "web-dist", "chunk.js"), content);
      } else {
        writeFileSync(join(dir, "machine.md"), content);
        if (scope !== "worktree") {
          git("add", ".");
          if (scope === "history") {
            git("commit", "-qm", "synthetic machine path");
            git("rm", "-q", "machine.md");
            git("commit", "-qm", "remove machine path");
          } else writeFileSync(join(dir, "machine.md"), "safe worktree");
        }
      }
      const result = scan(dir);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /personal machine path/);
      assert.doesNotMatch(
        result.stderr + result.stdout,
        new RegExp(syntheticUser),
      );
    }));
}
test("release scan detects home and Windows profile paths", () =>
  fixture((dir) => {
    writeFileSync(join(dir, "home.txt"), personalPaths[1]);
    writeFileSync(
      join(dir, "windows.json"),
      JSON.stringify({ path: personalPaths[2] }),
    );
    const result = scan(dir);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /home\.txt.*personal machine path/);
    assert.match(result.stderr, /windows\.json.*personal machine path/);
    assert.doesNotMatch(result.stderr, new RegExp(syntheticUser));
  }));
test("release scan accepts placeholder and non-filesystem path forms", () =>
  fixture((dir, git) => {
    writeFileSync(
      join(dir, "docs.md"),
      [
        "/Users/<user>/Library/Application Support/LifeOS",
        "$HOME/.life-os and ${HOME}/vault and ~/.life-os",
        "https://example.invalid/home/page and /api/users/list",
      ].join("\n"),
    );
    git("add", ".");
    git("commit", "-qm", "placeholders");
    const result = scan(dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }));
