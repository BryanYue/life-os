import Fastify from "fastify";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { resolve, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, readFileSync, mkdirSync } from "node:fs";
import { outsideRepository, projectRoot } from "./paths.js";
import { Store } from "./store.js";
import { importHealth, type HealthExport } from "./importers.js";
import { allocate } from "./planner.js";
import { acceptPlan, seedDemo, summary } from "./domain.js";
import type {
  SaveRequest,
  Module,
  PlanInput,
  PlanDraft,
  SyncPacket,
  EntityInput,
  Capability,
} from "./types.js";
const token = () => randomBytes(32).toString("hex");
const equal = (a: string, b: string) => {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
export function app(
  store: Store,
  options: {
    agentToken?: string;
    agentModules?: string[];
    syncModules?: string[];
    assets?: string;
  } = {},
) {
  const a = Fastify({ logger: false, bodyLimit: 2_000_000 });
  const sessions = new Map<string, { csrf: string; expires: number }>();
  const origins = [
    "http://127.0.0.1:4310",
    "http://localhost:4310",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
  ];
  a.addHook("onRequest", async (req, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
      );
    if (
      !/^(127\.0\.0\.1|localhost)(:4310|:5173)?$/.test(req.headers.host ?? "")
    )
      return reply.code(403).send({ error: "Host denied" });
    if (
      (req.headers.origin && !origins.includes(req.headers.origin)) ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      return reply.code(403).send({ error: "Origin denied" });
    if (!req.url.startsWith("/api/")) return;
    const authorization = req.headers.authorization;
    if (authorization !== undefined) {
      if (
        !options.agentToken ||
        !equal(authorization, "Bearer " + options.agentToken)
      )
        return reply.code(401).send({ error: "Invalid agent credential" });
      if (
        !["/api/agent/entities", "/api/agent/suggestions"].includes(
          req.url.split("?")[0],
        )
      )
        return reply.code(403).send({ error: "Agent endpoint denied" });
      return;
    }
    if (req.url === "/api/session" && req.method === "GET") return;
    const sid = /(?:^|;\s*)life_session=([a-f0-9]+)/.exec(
      req.headers.cookie ?? "",
    )?.[1];
    const session = sid ? sessions.get(sid) : null;
    if (!session || session.expires < Date.now())
      return reply.code(401).send({ error: "Local session required" });
    if (
      req.method !== "GET" &&
      !equal(String(req.headers["x-csrf-token"] ?? ""), session.csrf)
    )
      return reply.code(403).send({ error: "CSRF token required" });
  });
  a.setErrorHandler((e, _req, reply) => {
    const message = e instanceof Error ? e.message : "Request failed";
    reply
      .code(
        /Permission|AI may/.test(message)
          ? 403
          : /conflict|changed externally/.test(message)
            ? 409
            : 400,
      )
      .send({ error: message });
  });
  a.get("/api/session", async (req, reply) => {
    const existingId = /(?:^|;\s*)life_session=([a-f0-9]+)/.exec(
      req.headers.cookie ?? "",
    )?.[1];
    const existing = existingId ? sessions.get(existingId) : undefined;
    if (existing && existing.expires > Date.now())
      return { csrf: existing.csrf };
    for (const [id, s] of sessions)
      if (s.expires < Date.now()) sessions.delete(id);
    if (sessions.size > 100) throw Error("Too many sessions");
    const id = token(),
      csrf = token();
    sessions.set(id, { csrf, expires: Date.now() + 12 * 3600000 });
    reply.header(
      "Set-Cookie",
      `life_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`,
    );
    return { csrf };
  });
  a.get("/api/modules", () => store.modules());
  a.post<{ Body: Module }>("/api/modules", (req) => {
    store.register(req.body);
    return { ok: true };
  });
  a.post<{ Params: { id: string }; Body: { enabled: boolean } }>(
    "/api/modules/:id/enabled",
    (req) => {
      if (typeof req.body.enabled !== "boolean")
        throw Error("Invalid enabled state");
      store.setEnabled(req.params.id, req.body.enabled);
      return { ok: true };
    },
  );
  a.get<{
    Querystring: { module?: string; q?: string; includeDeleted?: string };
  }>("/api/entities", (req) =>
    store.list({
      ...req.query,
      includeDeleted: req.query.includeDeleted === "1",
    }),
  );
  a.post<{ Body: SaveRequest }>("/api/entities", (req) => store.save(req.body));
  a.get<{ Querystring: { module?: string } }>("/api/summary", (req) =>
    summary(store.list(req.query)),
  );
  a.post("/api/demo", () => seedDemo(store));
  a.post<{ Body: PlanInput }>("/api/plan", (req) => allocate(req.body));
  a.post<{ Body: { draft: PlanDraft } }>("/api/plan/accept", (req) =>
    acceptPlan(store, req.body.draft),
  );
  a.get("/api/conflicts", () => store.conflicts());
  a.post<{
    Params: { id: string };
    Body: { choice: "local" | "incoming"; expectedVersion?: number };
  }>("/api/conflicts/:id", (req) =>
    store.resolveConflict(
      req.params.id,
      req.body.choice,
      req.body.expectedVersion,
    ),
  );
  a.get("/api/backup", () => store.backup());
  a.post<{ Body: HealthExport }>("/api/import/health", (req) =>
    importHealth(store, req.body),
  );
  a.get("/api/audit", () => store.audit());
  a.get<{ Querystring: { cursor?: string } }>("/api/sync/export", (req) =>
    store.exportPacket(
      Number(req.query.cursor ?? 0),
      options.syncModules ?? [],
    ),
  );
  a.post<{ Body: { packet: SyncPacket } }>("/api/sync/import", (req) =>
    store.importPacket(req.body.packet, options.syncModules ?? []),
  );
  a.post<{ Body: { entity: EntityInput } }>("/api/import/source", (req) =>
    store.importSource(req.body.entity),
  );
  const agent: Capability = {
    actor: "local-agent",
    role: "ai",
    read: options.agentModules ?? [],
    write: [],
    suggest: options.agentModules ?? [],
  };
  a.get("/api/agent/entities", (req) => {
    if (
      !options.agentToken ||
      !equal(req.headers.authorization ?? "", "Bearer " + options.agentToken)
    )
      throw Error("Permission denied");
    return store.list({}, agent);
  });
  a.post<{ Body: SaveRequest }>("/api/agent/suggestions", (req) => {
    if (
      !options.agentToken ||
      !equal(req.headers.authorization ?? "", "Bearer " + options.agentToken)
    )
      throw Error("Permission denied");
    return store.save(req.body, agent);
  });
  a.get("/api/status", () => ({
    mode: "仅本机 · 数据默认仓库外",
    sync: "本地双副本模拟；未接通云供应商",
    syncModules: options.syncModules ?? [],
    watch: "未联动：需要获准的 iPhone 桥接；可手动记录",
    trading: "无实盘、支付或转账接口",
    ai: "默认无账户连接；规则建议需人工采纳",
    restoredIsolated: !!store.db
      .prepare("SELECT 1 FROM meta WHERE key='restored_isolated'")
      .get(),
  }));
  const assets = options.assets ?? resolve("web-dist");
  if (existsSync(assets)) {
    const files = new Map<string, string>();
    const scan = (d: string, p = "") => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const rel = p + "/" + e.name;
        if (e.isDirectory()) scan(join(d, e.name), rel);
        else if (e.isFile()) files.set(rel, join(d, e.name));
      }
    };
    scan(assets);
    a.get("/*", async (req, reply) => {
      const pathname = req.url.split("?")[0];
      const path = files.get(pathname === "/" ? "/index.html" : pathname);
      if (!path) return reply.code(404).send({ error: "Not found" });
      const mime: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
      };
      return reply
        .type(mime[extname(path)] ?? "application/octet-stream")
        .send(readFileSync(path));
    });
  }
  return a;
}
const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const project = projectRoot;
  const root = outsideRepository(
    process.env.LIFE_OS_HOME ?? join(homedir(), ".life-os"),
  );
  const store = new Store(root);
  const plugins = join(root, "plugins");
  mkdirSync(plugins, { recursive: true });
  for (const f of readdirSync(plugins).filter((f) => f.endsWith(".json"))) {
    const m = JSON.parse(readFileSync(join(plugins, f), "utf8")) as Module;
    if (!store.modules().some((x) => x.id === m.id)) store.register(m);
  }
  const configPath = join(root, "config.json");
  const config = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, "utf8"))
    : {};
  const a = app(store, {
    agentToken: config.agentToken,
    agentModules: config.agentModules,
    syncModules: config.syncModules,
    assets: join(project, "web-dist"),
  });
  await a.listen({ host: "127.0.0.1", port: 4310 });
  const stop = async () => {
    await a.close();
    store.close();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  console.log("Life OS: http://127.0.0.1:4310");
}
