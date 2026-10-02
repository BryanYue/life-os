import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/store.js";
import { app } from "../src/server.js";
import { projectRoot } from "../src/paths.js";
import type { EntityInput, Module, SyncScope } from "../src/types.js";

type Server = ReturnType<typeof app>;
const host = { host: "127.0.0.1:4310" };
const agentToken = "synthetic-lifecycle-agent";
const agent = { ...host, authorization: "Bearer " + agentToken };
async function session(server: Server) {
  const response = await server.inject({ url: "/api/session", headers: host });
  assert.equal(response.statusCode, 200, response.body);
  return {
    ...host,
    cookie: String(response.headers["set-cookie"]).split(";")[0],
    "x-csrf-token": response.json().csrf as string,
  };
}
async function protectedMutation(
  server: Server,
  headers: Awaited<ReturnType<typeof session>>,
  url: string,
  payload: Record<string, unknown>,
) {
  for (const [requestHeaders, status] of [
    [host, 401],
    [{ ...host, cookie: headers.cookie }, 403],
    [agent, 403],
  ] as const) {
    const response = await server.inject({
      method: "POST",
      url,
      payload,
      headers: requestHeaders,
    });
    assert.equal(response.statusCode, status, url + ": " + response.body);
  }
}
const record = (
  module: string,
  patch: Partial<EntityInput> = {},
): EntityInput => ({
  module,
  type: "goal",
  title: "Synthetic private title",
  kind: "plan",
  status: "active",
  occurredAt: "2030-04-01",
  timeZone: "UTC",
  fields: {
    shared: "Synthetic shared value",
    secret: "Synthetic private field",
  },
  relations: [],
  body: "Synthetic private body",
  ...patch,
});

test("HTTP bootstrap and namespaced field projections persist through their routes while scoped Agents and mutation guards preserve private data", async () => {
  const root = mkdtempSync(join(tmpdir(), "life-lifecycle-api-sync-"));
  const source = new Store(join(root, "source")),
    target = new Store(join(root, "target"));
  const module: Module = {
    id: "demo.api-goals",
    name: "Synthetic API goals",
    version: "1.0.0",
    coreApi: 1,
    schemaVersion: 1,
    codeVisibility: "public",
    enabled: true,
    entityTypes: [
      {
        id: "goal",
        name: "Goal",
        fields: [
          { key: "shared", label: "Shared", type: "text" },
          { key: "secret", label: "Secret", type: "text" },
        ],
      },
    ],
    relations: [],
    views: ["list", "form"],
  };
  source.register(module);
  const selected = source.save({
    entity: record(module.id),
    expectedVersion: 0,
  });
  source.save({
    entity: record(module.id, { title: "Excluded synthetic entity" }),
    expectedVersion: 0,
  });
  const scope: SyncScope = {
    modules: [module.id],
    entities: { [module.id]: { entityIds: [selected.id], fields: ["shared"] } },
  };
  const sourceServer = app(source, { syncModules: [module.id], agentToken });
  const targetServer = app(target, { syncModules: [module.id], agentToken });
  const projector = app(source, {
    syncScope: scope,
    agentToken,
    agentModules: [module.id],
    agentScope: scope.entities,
  });
  const projectionTarget = app(target, { syncScope: scope, agentToken });
  try {
    const sourceHeaders = await session(sourceServer),
      targetHeaders = await session(targetServer),
      projectorHeaders = await session(projector),
      projectionHeaders = await session(projectionTarget);
    const exported = await sourceServer.inject({
      url: "/api/sync/bootstrap",
      headers: sourceHeaders,
    });
    assert.equal(exported.statusCode, 200, exported.body);
    const packet = exported.json();
    await protectedMutation(
      targetServer,
      targetHeaders,
      "/api/sync/bootstrap",
      { packet, acceptManifests: true },
    );
    const unaccepted = await targetServer.inject({
      method: "POST",
      url: "/api/sync/bootstrap",
      headers: targetHeaders,
      payload: { packet },
    });
    assert.equal(unaccepted.statusCode, 400);
    assert.match(unaccepted.json().error, /manifest acceptance/);
    assert.equal(target.list().length, 0);
    const imported = await targetServer.inject({
      method: "POST",
      url: "/api/sync/bootstrap",
      headers: targetHeaders,
      payload: { packet, acceptManifests: true },
    });
    assert.equal(imported.statusCode, 200, imported.body);
    assert.equal(imported.json().applied, 2);
    const replay = await targetServer.inject({
      method: "POST",
      url: "/api/sync/bootstrap",
      headers: targetHeaders,
      payload: { packet, acceptManifests: true },
    });
    assert.equal(replay.json().applied, 0);
    const agentRead = await projector.inject({
      url: "/api/agent/entities",
      headers: agent,
    });
    assert.equal(agentRead.statusCode, 200, agentRead.body);
    const visible = agentRead.json();
    assert.equal(visible.length, 1);
    assert.equal(visible[0].id, selected.id);
    assert.deepEqual(visible[0].fields, { shared: selected.fields.shared });
    assert.equal(visible[0].title, "");
    assert.equal(visible[0].body, "");
    assert.equal(visible[0].noteHash, "");
    const exportedProjection = await projector.inject({
      url: "/api/sync/projection",
      headers: projectorHeaders,
    });
    assert.equal(exportedProjection.statusCode, 200, exportedProjection.body);
    const projection = exportedProjection.json();
    assert.equal(projection.records[0].module, module.id);
    assert.equal(
      JSON.stringify(projection).includes("Synthetic private"),
      false,
    );
    await protectedMutation(
      projectionTarget,
      projectionHeaders,
      "/api/sync/projection",
      { packet: projection },
    );
    const projected = await projectionTarget.inject({
      method: "POST",
      url: "/api/sync/projection",
      headers: projectionHeaders,
      payload: { packet: projection },
    });
    assert.equal(projected.statusCode, 200, projected.body);
    assert.equal(projected.json().readOnly, true);
    const projections = await projectionTarget.inject({
      url: "/api/sync/projections",
      headers: projectionHeaders,
    });
    assert.equal(projections.json().length, 1);
    assert.deepEqual(projections.json()[0].records[0].fields, {
      shared: selected.fields.shared,
    });
    assert.equal(
      target.get(selected.id)!.fields.secret,
      selected.fields.secret,
    );
    assert.equal(target.get(selected.id)!.body, selected.body);
  } finally {
    for (const server of [
      sourceServer,
      targetServer,
      projector,
      projectionTarget,
    ])
      await server.close();
    source.close();
    target.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("HTTP plugin lifecycle requires session, CSRF and explicit grants, invokes trusted code, and preserves records after disabling", async () => {
  const root = mkdtempSync(join(tmpdir(), "life-lifecycle-api-plugin-"));
  const code = join(root, "code");
  cpSync(join(projectRoot, "examples/plugin-plants"), code, {
    recursive: true,
  });
  const store = new Store(join(root, "data"));
  const server = app(store, { agentToken });
  const id = "demo.plugin-plants";
  try {
    const headers = await session(server);
    const post = (url: string, payload: Record<string, unknown> = {}) =>
      server.inject({ method: "POST", url, headers, payload });
    const pluginRequest = {
      entity: record(id, {
        type: "plant",
        kind: "inference",
        status: "draft",
        fields: { nickname: "Synthetic fern", waterMl: 30 },
      }),
      expectedVersion: 0,
    };
    const authorization = {
      permissions: ["read-plants", "suggest-plants"],
      trustLocalCode: true,
      acknowledgeUnsandboxedNetwork: true,
    };
    for (const [url, payload] of [
      ["/api/plugins/install", { path: join(code, "manifest.json") }],
      [`/api/plugins/${id}/authorize`, authorization],
      [`/api/plugins/${id}/enable`, {}],
      [
        `/api/plugins/${id}/import/draft-json`,
        { text: JSON.stringify(pluginRequest) },
      ],
      [`/api/plugins/${id}/invoke/summarize`, { input: {} }],
      [`/api/plugins/${id}/disable`, {}],
    ] as [string, Record<string, unknown>][])
      await protectedMutation(server, headers, url, payload);
    assert.equal(
      store.modules().some((m) => m.id === id),
      false,
    );
    const installed = await post("/api/plugins/install", {
      path: join(code, "manifest.json"),
    });
    assert.equal(installed.statusCode, 200, installed.body);
    assert.equal(installed.json().authorized, false);
    const denied = await post(`/api/plugins/${id}/enable`);
    assert.equal(denied.statusCode, 400);
    assert.match(denied.json().error, /authorization/);
    const authorized = await post(
      `/api/plugins/${id}/authorize`,
      authorization,
    );
    assert.equal(authorized.statusCode, 200, authorized.body);
    assert.equal(
      (await post(`/api/plugins/${id}/enable`)).json().state,
      "enabled",
    );
    const imported = await post(`/api/plugins/${id}/import/draft-json`, {
      text: JSON.stringify(pluginRequest),
    });
    assert.equal(imported.statusCode, 200, imported.body);
    const saved = store.list({ module: id })[0];
    assert.equal(saved.kind, "inference");
    assert.equal(saved.status, "draft");
    const invoked = await post(`/api/plugins/${id}/invoke/summarize`, {
      input: {},
    });
    assert.equal(invoked.statusCode, 200, invoked.body);
    assert.deepEqual(invoked.json(), { count: 1, waterMl: 30 });
    const forbiddenWrite = await post(`/api/plugins/${id}/invoke/write`, {
      input: pluginRequest,
    });
    assert.notEqual(forbiddenWrite.statusCode, 200);
    assert.match(forbiddenWrite.json().error, /permission denied/);
    assert.equal(
      (await post(`/api/plugins/${id}/disable`)).json().state,
      "disabled",
    );
    const disabled = await post(`/api/plugins/${id}/invoke/summarize`, {
      input: {},
    });
    assert.notEqual(disabled.statusCode, 200);
    assert.match(disabled.json().error, /disabled/);
    const listing = await server.inject({ url: "/api/plugins", headers });
    assert.equal(listing.json().plugins[0].state, "disabled");
    assert.equal(store.get(saved.id)!.fields.waterMl, 30);
  } finally {
    await server.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
