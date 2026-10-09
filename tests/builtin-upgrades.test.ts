import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { legacyBuiltins, builtins } from "../src/modules.js";
import {
  pendingBuiltinUpgrades,
  upgradeBuiltin,
} from "../src/builtin-upgrades.js";
import {
  createReadingMaterial,
  recordReading,
  addReadingVocabulary,
} from "../src/reading.js";
import { summary } from "../src/domain.js";
import { exportBootstrap, importBootstrap } from "../src/sync.js";
import { app } from "../src/server.js";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "life-learning-upgrade-"));
  const s = new Store(join(root, "data"));
  for (const id of ["learning", "languages"])
    s.db
      .prepare("UPDATE modules SET json=? WHERE id=?")
      .run(JSON.stringify(legacyBuiltins.find((m) => m.id === id)), id);
  return {
    root,
    s,
    close() {
      s.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
const base = {
  kind: "fact" as const,
  status: "done" as const,
  occurredAt: "2030-04-01T09:00:00Z",
  timeZone: "UTC",
  body: "Original fictional user note\n",
  relations: [],
};
test("known v1 learning/language upgrade preserves records, unknown frontmatter, disabled/private flags, backup recovery and old sync receipts", () => {
  const f = fixture();
  let restored: Store | undefined;
  const peer = new Store(join(f.root, "peer"));
  try {
    const note = f.s.save({
      entity: {
        ...base,
        module: "learning",
        type: "material",
        title: "Fictional legacy material",
        fields: { author: "Fictional author", progress: 20 },
      },
      expectedVersion: 0,
    });
    f.s.save({
      entity: {
        ...base,
        module: "languages",
        type: "practice",
        title: "Existing independent English",
        fields: { language: "英语", skill: "读", minutes: 12 },
      },
      expectedVersion: 0,
    });
    const file = f.s.vault.read(note.id)!.path;
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace(
        "---\n",
        "---\nuser_preserved: original\n",
      ),
    );
    const old = f.s.module("learning");
    old.enabled = false;
    old.codeVisibility = "private";
    f.s.db
      .prepare("UPDATE modules SET json=? WHERE id=?")
      .run(JSON.stringify(old), "learning");
    assert.equal(pendingBuiltinUpgrades(f.s).pending.length, 2);
    const result = upgradeBuiltin(f.s, "learning");
    assert.equal(f.s.module("learning", false).enabled, false);
    assert.equal(f.s.module("learning", false).codeVisibility, "private");
    assert.equal(f.s.get(note.id)!.body, base.body);
    assert.equal(f.s.get(note.id)!.fields.author, "Fictional author");
    assert.match(readFileSync(file, "utf8"), /user_preserved: original/);
    assert.equal(upgradeBuiltin(f.s, "learning").alreadyCurrent, true);
    restored = Store.restore(
      join(f.root, "restored"),
      JSON.parse(readFileSync(result.backup!, "utf8")),
    );
    assert.equal(restored.module("learning", false).schemaVersion, 1);
    assert.equal(restored.get(note.id)!.body, base.body);
    upgradeBuiltin(f.s, "languages");
    assert.equal(pendingBuiltinUpgrades(f.s).pending.length, 0);
    f.s.setEnabled("learning", true);
    const baseline = exportBootstrap(f.s, ["learning", "languages"]);
    importBootstrap(peer, baseline, ["learning", "languages"], {
      acceptManifests: true,
    });
    assert.equal(peer.get(note.id)!.body, base.body);
    assert.equal(
      peer.importPacket(f.s.exportPacket(0, ["learning", "languages"]), [
        "learning",
        "languages",
      ]).applied,
      0,
    );
  } finally {
    restored?.close();
    peer.close();
    f.close();
  }
});
test("custom old manifests are detected and never overwritten by the builtin upgrade", () => {
  const f = fixture();
  try {
    const customized = f.s.module("learning");
    customized.entityTypes
      .find((t) => t.id === "material")!
      .fields.push({ key: "customValue", label: "Custom", type: "text" });
    f.s.db
      .prepare("UPDATE modules SET json=? WHERE id=?")
      .run(JSON.stringify(customized), "learning");
    assert.equal(
      pendingBuiltinUpgrades(f.s).pending.find((m) => m.module === "learning")!
        .compatible,
      false,
    );
    assert.throws(
      () => upgradeBuiltin(f.s, "learning"),
      /reviewed local migration/,
    );
    assert.deepEqual(f.s.module("learning"), customized);
    assert.equal(
      f.s.db.prepare("SELECT * FROM module_migrations").all().length,
      0,
    );
  } finally {
    f.close();
  }
});
test("canonical reading time appears in language summary once while vocabulary and domain goal views add no extra minutes", () => {
  const f = fixture();
  try {
    upgradeBuiltin(f.s, "learning");
    upgradeBuiltin(f.s, "languages");
    const goals = ["projects", "quant", "languages"].map((module) =>
      f.s.save({
        entity: {
          ...base,
          module,
          type: "goal",
          title: "Synthetic " + module,
          kind: "plan",
          status: "active",
          fields: {},
        },
        expectedVersion: 0,
      }),
    );
    const material = createReadingMaterial(f.s, {
      operationId: "source",
      title: "Fictional technical text",
      reference: "synthetic://reading",
      sourceType: "技术文档",
      language: "英语",
      rights: "虚构样例",
      ...base,
    });
    const reading = recordReading(f.s, {
      operationId: "reading",
      materialId: material.id,
      minutes: 30,
      goalIds: goals.map((g) => g.id),
      ...base,
    });
    addReadingVocabulary(f.s, {
      operationId: "word",
      materialId: material.id,
      sessionId: reading.id,
      term: "model",
      meaning: "虚构示例释义",
      context: "A fictional model.",
      ...base,
    });
    f.s.save({
      entity: {
        ...base,
        module: "languages",
        type: "practice",
        title: "Separate Japanese reading",
        fields: { language: "日语", skill: "读", minutes: 10 },
      },
      expectedVersion: 0,
    });
    const result = summary(f.s.list(), "languages");
    assert.deepEqual(result.minutesByLanguage, { 日语: 10, 英语: 30 });
    assert.equal(result.integratedReadingMinutes, 30);
    assert.equal(
      summary([...f.s.list(), reading]).integratedReadingMinutes,
      30,
    );
    assert.equal(
      f.s.list().some((e) => e.fields.language === "法语"),
      false,
      "optional language never creates a task by default",
    );
  } finally {
    f.close();
  }
});
test("HTTP builtin upgrade requires a human session and explicit CSRF-protected action", async () => {
  const f = fixture(),
    server = app(f.s, {
      agentToken: "synthetic-upgrade-token",
      agentModules: ["learning"],
    });
  const host = { host: "localhost:4310" };
  try {
    const unauth = await server.inject({
      method: "POST",
      url: "/api/builtin-upgrades",
      headers: host,
      payload: { module: "learning" },
    });
    assert.equal(unauth.statusCode, 401);
    const agent = await server.inject({
      method: "POST",
      url: "/api/builtin-upgrades",
      headers: { ...host, authorization: "Bearer synthetic-upgrade-token" },
      payload: { module: "learning" },
    });
    assert.equal(agent.statusCode, 403);
    const session = await server.inject({ url: "/api/session", headers: host }),
      cookie = String(session.headers["set-cookie"]).split(";")[0];
    const headers = { ...host, cookie, "x-csrf-token": session.json().csrf };
    assert.equal(
      (await server.inject({ url: "/api/builtin-upgrades", headers })).json()
        .pending.length,
      2,
    );
    assert.equal(
      (
        await server.inject({
          method: "POST",
          url: "/api/builtin-upgrades",
          headers: { ...host, cookie },
          payload: { module: "learning" },
        })
      ).statusCode,
      403,
    );
    const result = await server.inject({
      method: "POST",
      url: "/api/builtin-upgrades",
      headers,
      payload: { module: "learning" },
    });
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().toSchema, 2);
    assert.ok(result.json().backup);
    assert.equal(
      (
        await server.inject({
          method: "POST",
          url: "/api/builtin-upgrades",
          headers,
          payload: { module: "learning" },
        })
      ).json().alreadyCurrent,
      true,
    );
    assert.equal(
      f.s.module("learning").schemaVersion,
      builtins.find((m) => m.id === "learning")!.schemaVersion,
    );
  } finally {
    await server.close();
    f.close();
  }
});
