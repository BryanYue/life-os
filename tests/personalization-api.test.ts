import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { app } from "../src/server.js";
import { Store } from "../src/store.js";
import type { Module } from "../src/types.js";
import type { TemplateDefinition } from "../src/templates.js";

const date = { occurredAt: "2030-04-01T09:00:00Z", timeZone: "UTC" };
const host = { host: "localhost:4310" };
const customTemplate: TemplateDefinition = {
  id: "personal.integration-reading",
  version: 1,
  name: "Synthetic reading plan",
  requires: ["learning"],
  parameters: [
    { key: "title", label: "Title", type: "text", default: "Fictional plan" },
  ],
  target: {
    module: "learning",
    type: "checklist-item",
    kind: "plan",
    status: "draft",
  },
  defaults: {
    title: { parameter: "title" },
    fields: { focus: "Synthetic integration question" },
  },
};
function contractModule(enabled: boolean): Module {
  return {
    id: "personal.integration-contract",
    name: "Synthetic executable module",
    version: "0.1.0",
    coreApi: 1,
    schemaVersion: 1,
    codeVisibility: "private",
    enabled,
    entityTypes: [{ id: "record", name: "Record", fields: [] }],
    relations: [],
    views: ["list"],
    contract: {
      protocol: 1,
      core: { api: 1, minVersion: "0.1.0" },
      dependencies: [],
      importers: [],
      permissions: [
        { id: "read", action: "read", module: "personal.integration-contract" },
      ],
      operations: [{ id: "list", handler: "list", permissions: ["read"] }],
    },
  };
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "life-personalization-http-")),
    data = join(root, "data");
  let store = new Store(data),
    server = app(store, { agentToken: "synthetic-management-agent" });
  return {
    root,
    data,
    get store() {
      return store;
    },
    get server() {
      return server;
    },
    async restart() {
      await server.close();
      store.close();
      store = new Store(data);
      server = app(store, { agentToken: "synthetic-management-agent" });
    },
    async close() {
      await server.close();
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
type Fixture = ReturnType<typeof fixture>;
async function session(f: Fixture) {
  const response = await f.server.inject({
    url: "/api/session",
    headers: host,
  });
  assert.equal(response.statusCode, 200);
  return {
    ...host,
    cookie: String(response.headers["set-cookie"]).split(";")[0],
    "x-csrf-token": String(response.json().csrf),
  };
}
function state(f: Fixture) {
  return {
    backup: f.store.backup(),
    files: readdirSync(f.data, { recursive: true })
      .map(String)
      .filter((path) => !path.startsWith("life.sqlite"))
      .sort()
      .map((path) => {
        try {
          return [path, readFileSync(join(f.data, path)).toString("base64")];
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EISDIR")
            return [path, "directory"];
          throw error;
        }
      }),
  };
}
async function post(
  f: Fixture,
  headers: Awaited<ReturnType<typeof session>>,
  url: string,
  payload: unknown,
  expected = 200,
) {
  const response = await f.server.inject({
    method: "POST",
    url,
    headers: { ...headers, "content-type": "application/json" },
    payload: JSON.stringify(payload),
  });
  assert.equal(response.statusCode, expected, `${url}: ${response.body}`);
  return response;
}

test("HTTP profile/catalog GET is read-only; revision updates persist and bad configuration cannot reset settings", async () => {
  const f = fixture();
  try {
    const headers = await session(f),
      before = state(f);
    for (const url of [
      "/api/profile",
      "/api/categories",
      "/api/languages",
      "/api/templates",
    ]) {
      const response = await f.server.inject({ url, headers });
      assert.equal(response.statusCode, 200, response.body);
    }
    assert.deepEqual(state(f), before);
    assert.equal(existsSync(join(f.data, "personal-profile.json")), false);
    const changed = await post(f, headers, "/api/profile", {
      expectedRevision: 0,
      patch: {
        navigation: { labels: { learning: "Synthetic studies" } },
        history: { includeDisabled: true },
      },
    });
    assert.equal(changed.json().revision, 1);
    assert.equal(
      changed.json().navigation.labels.learning,
      "Synthetic studies",
    );
    const saved = state(f);
    await post(
      f,
      headers,
      "/api/profile",
      { expectedRevision: 0, patch: { history: { includeDisabled: false } } },
      409,
    );
    for (const patch of [
      { profileVersion: 99 },
      { modules: { learning: false } },
      { navigation: { order: ["unknown-category"] } },
      { languagePreferences: { activeCodes: ["invalid_locale"] } },
      {
        languagePreferences: {
          customLanguages: [{ code: "EN", name: "Duplicate" }],
        },
      },
      { history: { includeDisabled: "yes" } },
      { unexpected: true },
    ])
      await post(
        f,
        headers,
        "/api/profile",
        { expectedRevision: 1, patch },
        400,
      );
    assert.deepEqual(state(f), saved);
    await f.restart();
    const persisted = await f.server.inject({
      url: "/api/profile",
      headers: await session(f),
    });
    assert.equal(persisted.json().revision, 1);
    assert.equal(
      persisted.json().navigation.labels.learning,
      "Synthetic studies",
    );
  } finally {
    await f.close();
  }
});

test("HTTP Korean configuration is independent from explicit schema upgrades and survives stop-study with one reading total", async () => {
  const f = fixture();
  try {
    const headers = await session(f);
    await post(f, headers, "/api/profile", {
      expectedRevision: 0,
      patch: {
        languagePreferences: {
          activeCodes: ["ko"],
          customLanguages: [{ code: "ko", name: "韩语" }],
        },
      },
    });
    const catalog = await f.server.inject({ url: "/api/languages", headers });
    assert.equal(
      catalog
        .json()
        .catalog.find((item: { code: string }) => item.code === "ko").name,
      "韩语",
    );
    assert.equal(f.store.module("learning").schemaVersion, 2);
    const material = {
      ...date,
      operationId: "http-config-korean-source",
      title: "Fictional Korean source",
      reference: "synthetic://korean",
      sourceType: "技术文档",
      language: "ko",
      rights: "虚构样例",
      body: "Fictional original",
    };
    const unchanged = state(f);
    await post(f, headers, "/api/reading/materials", material, 400);
    assert.deepEqual(state(f), unchanged);
    for (const module of ["learning", "languages"]) {
      const upgraded = await post(f, headers, "/api/languages/upgrade", {
        module,
      });
      assert.equal(upgraded.json().toSchema, 3);
      assert.ok(upgraded.json().backup);
    }
    const source = (
      await post(f, headers, "/api/reading/materials", material)
    ).json();
    const reading = (
      await post(f, headers, "/api/reading/sessions", {
        ...date,
        operationId: "http-config-korean-session",
        materialId: source.id,
        minutes: 20,
        goalIds: [],
      })
    ).json();
    await post(f, headers, "/api/reading/vocabulary", {
      ...date,
      operationId: "http-config-korean-word",
      materialId: source.id,
      sessionId: reading.id,
      term: "모형",
      meaning: "Synthetic model",
      context: "Synthetic context",
    });
    await post(f, headers, "/api/entities", {
      expectedVersion: 0,
      entity: {
        ...date,
        module: "languages",
        type: "practice",
        title: "Fictional independent Korean practice",
        kind: "fact",
        status: "done",
        fields: { language: "ko", skill: "读", minutes: 7 },
        relations: [],
        body: "Synthetic practice",
      },
    });
    await post(f, headers, "/api/profile", {
      expectedRevision: 1,
      patch: { languagePreferences: { activeCodes: [] } },
    });
    const report = await f.server.inject({
      url: "/api/reports/reading",
      headers,
    });
    assert.equal(report.json().uniqueTotalMinutes, 20);
    assert.equal(report.json().byLanguage[0].language, "韩语");
    assert.equal(report.json().byLanguage[0].minutes, 20);
    assert.equal(report.json().issues.length, 0);
    const summary = await f.server.inject({
      url: "/api/summary?module=languages",
      headers,
    });
    assert.equal(summary.json().minutesByLanguage["韩语"], 27);
    assert.equal(f.store.get(source.id)!.fields.language, "ko");
  } finally {
    await f.close();
  }
});

test("HTTP module disable, restart and re-enable preserve factual records and block writes while disabled", async () => {
  const f = fixture();
  try {
    let headers = await session(f);
    const entity = {
      ...date,
      module: "learning",
      type: "note",
      title: "Fictional retained history",
      kind: "fact",
      status: "done",
      fields: { topic: "Synthetic topic" },
      relations: [],
      body: "Original fictional note",
    };
    const saved = (
      await post(f, headers, "/api/entities", { entity, expectedVersion: 0 })
    ).json();
    await post(f, headers, "/api/modules/learning/enabled", { enabled: false });
    assert.equal(f.store.get(saved.id)!.body, entity.body);
    await post(
      f,
      headers,
      "/api/entities",
      { entity: { ...entity, title: "Must not save" }, expectedVersion: 0 },
      400,
    );
    await f.restart();
    headers = await session(f);
    const profile = await f.server.inject({ url: "/api/profile", headers });
    assert.equal(profile.json().modules.learning, false);
    const history = await f.server.inject({
      url: "/api/entities?module=learning",
      headers,
    });
    assert.equal(history.json()[0].id, saved.id);
    assert.equal(history.json()[0].body, entity.body);
    await post(f, headers, "/api/modules/learning/enabled", { enabled: true });
    assert.equal(f.store.module("learning").enabled, true);
    assert.equal(f.store.get(saved.id)!.version, saved.version);
    assert.deepEqual(f.store.get(saved.id)!.fields, saved.fields);
    assert.equal(f.store.list({ module: "learning" }).length, 1);
  } finally {
    await f.close();
  }
});

test("HTTP direct executable registration and module/profile activation cannot bypass plugin authorization", async () => {
  const f = fixture();
  try {
    const headers = await session(f),
      before = state(f);
    await post(f, headers, "/api/modules", contractModule(true), 400);
    assert.deepEqual(state(f), before);
    await post(f, headers, "/api/modules", contractModule(false));
    const installed = state(f),
      id = "personal.integration-contract";
    await post(
      f,
      headers,
      `/api/modules/${id}/enabled`,
      { enabled: true },
      400,
    );
    await post(
      f,
      headers,
      "/api/profile",
      { expectedRevision: 0, patch: { modules: { [id]: true } } },
      400,
    );
    assert.deepEqual(state(f), installed);
    assert.equal(f.store.module(id, false).enabled, false);
    const plugins = await f.server.inject({ url: "/api/plugins", headers });
    assert.equal(plugins.json().plugins.length, 0);
  } finally {
    await f.close();
  }
});

test("HTTP template registration creates no plans, previews write nothing and explicit apply retries preserve current edits across restart", async () => {
  const f = fixture();
  try {
    let headers = await session(f);
    await post(f, headers, "/api/templates/register", {
      template: customTemplate,
    });
    assert.equal(f.store.list().length, 0);
    const before = state(f),
      request = {
        ...date,
        templateId: customTemplate.id,
        parameters: { title: "Fictional adopted plan" },
      };
    const preview = await post(f, headers, "/api/templates/preview", request);
    assert.equal(preview.json().entity.kind, "plan");
    assert.deepEqual(state(f), before);
    const apply = { ...request, operationId: "http-personal-plan" },
      adopted = (await post(f, headers, "/api/templates/apply", apply)).json();
    const after = state(f),
      retried = (await post(f, headers, "/api/templates/apply", apply)).json();
    assert.equal(retried.id, adopted.id);
    assert.deepEqual(state(f), after);
    await post(f, headers, "/api/entities", {
      expectedVersion: adopted.version,
      expectedNoteHash: adopted.noteHash,
      entity: { ...adopted, title: "Later human edit" },
    });
    await f.restart();
    headers = await session(f);
    const saved = state(f),
      replay = (await post(f, headers, "/api/templates/apply", apply)).json();
    assert.equal(replay.id, adopted.id);
    assert.equal(replay.title, "Later human edit");
    assert.deepEqual(state(f), saved);
    await post(
      f,
      headers,
      "/api/templates/apply",
      { ...apply, parameters: { title: "Changed receipt content" } },
      400,
    );
    assert.deepEqual(state(f), saved);
  } finally {
    await f.close();
  }
});

test("new HTTP management entrypoints reject missing sessions, Agent credentials and absent CSRF before side effects", async () => {
  const f = fixture();
  try {
    const headers = await session(f),
      before = state(f);
    for (const url of [
      "/api/profile",
      "/api/categories",
      "/api/languages",
      "/api/templates",
    ]) {
      assert.equal(
        (await f.server.inject({ url, headers: host })).statusCode,
        401,
      );
      assert.equal(
        (
          await f.server.inject({
            url,
            headers: {
              ...host,
              authorization: "Bearer synthetic-management-agent",
            },
          })
        ).statusCode,
        403,
      );
    }
    for (const [url, payload] of [
      ["/api/profile", { patch: {}, expectedRevision: 0 }],
      ["/api/languages/upgrade", { module: "learning" }],
      ["/api/templates/register", { template: customTemplate }],
      ["/api/templates/preview", { ...date, templateId: "reading.basic" }],
      [
        "/api/templates/apply",
        {
          ...date,
          templateId: "reading.basic",
          operationId: "unauthorized-plan",
        },
      ],
      ["/api/modules/learning/enabled", { enabled: false }],
    ] as const) {
      assert.equal(
        (await f.server.inject({ method: "POST", url, payload, headers: host }))
          .statusCode,
        401,
      );
      assert.equal(
        (
          await f.server.inject({
            method: "POST",
            url,
            payload,
            headers: {
              ...host,
              authorization: "Bearer synthetic-management-agent",
            },
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await f.server.inject({
            method: "POST",
            url,
            payload,
            headers: { ...host, cookie: headers.cookie },
          })
        ).statusCode,
        403,
      );
    }
    assert.deepEqual(state(f), before);
  } finally {
    await f.close();
  }
});
