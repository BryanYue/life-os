import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  Conflict,
  Entity,
  EntityInput,
  Field,
  Module,
  PlanDraft,
  PlanInput,
  SaveRequest,
} from "../src/types.js";
import "./styles.css";
import {
  FinancePanel,
  HealthPanel,
  ResearchPanel,
} from "./SpecialistPanels.js";
import { PeriodPlanner, ReviewPanel } from "./PeriodPlanner.js";
import { SyncTools } from "./SyncTools.js";
import { PluginTools } from "./PluginTools.js";

type Page = "home" | "module" | "planner" | "settings";
type Summary = {
  counts: { plan: number; fact: number; inference: number };
  byType: Record<string, number>;
  minutesByLanguage?: Record<string, number>;
  finance?: { currency: string; category: string; total: string }[];
};
const kinds = { plan: "计划", fact: "事实", inference: "推断" };
const statuses = {
  draft: "草稿",
  active: "进行中",
  done: "已完成",
  failed: "未完成",
};
const symbols: Record<string, string> = {
  planning: "◷",
  health: "♡",
  learning: "▤",
  projects: "⌘",
  languages: "文",
  quant: "⌁",
  finance: "¥",
  family: "⌂",
};
const shortDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleString("zh-CN", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
};
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const localTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? ""
    : new Date(date.valueOf() - date.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
};
const minuteTime = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
const timeMinute = (value: string) => {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
};
const entityInput = (entity: Entity): EntityInput => ({
  id: entity.id,
  module: entity.module,
  type: entity.type,
  title: entity.title,
  kind: entity.kind,
  status: entity.status,
  occurredAt: entity.occurredAt,
  timeZone: entity.timeZone,
  fields: entity.fields,
  relations: entity.relations,
  body: entity.body,
  source: entity.source,
  deleted: entity.deleted,
});

function App() {
  const [csrf, setCsrf] = useState("");
  const [modules, setModules] = useState<Module[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [page, setPage] = useState<Page>("home");
  const [moduleId, setModuleId] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "timeline">("list");
  const [showComparison, setShowComparison] = useState(false);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [filter, setFilter] = useState<"all" | Entity["kind"]>("all");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [status, setStatus] = useState<Record<string, unknown>>({});
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<{
    module: Module;
    entity?: Entity;
    review?: boolean;
  } | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const activeModule = modules.find((module) => module.id === moduleId);
  async function request<T>(
    path: string,
    body?: unknown,
    token = csrf,
  ): Promise<T> {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers:
        body === undefined
          ? {}
          : { "Content-Type": "application/json", "x-csrf-token": token },
      ...(body === undefined
        ? {}
        : { method: "POST", body: JSON.stringify(body) }),
    });
    const data: unknown = await response.json().catch(() => ({
      error: `服务返回了无法读取的响应（${response.status}）`,
    }));
    if (!response.ok) {
      const message =
        typeof data === "object" && data !== null && "error" in data
          ? String(data.error)
          : `请求失败（${response.status}）`;
      throw new Error(
        response.status === 409
          ? `版本冲突：${message}。本次修改未覆盖已有记录，请保留文本并刷新后核对。`
          : message,
      );
    }
    return data as T;
  }
  async function refresh(token = csrf) {
    const results = await Promise.all([
      request<Entity[]>("/api/entities?includeDeleted=1", undefined, token),
      request<Conflict[]>("/api/conflicts", undefined, token),
      request<Record<string, unknown>>("/api/status", undefined, token),
      request<Module[]>("/api/modules", undefined, token),
    ]);
    setEntities(results[0]);
    setConflicts(results[1]);
    setStatus(results[2]);
    setModules(results[3].filter((module) => module.enabled));
  }
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await request<{ csrf: string }>("/api/session");
        const listed = await request<Module[]>(
          "/api/modules",
          undefined,
          session.csrf,
        );
        if (cancelled) return;
        setCsrf(session.csrf);
        setModules(listed.filter((module) => module.enabled));
        setModuleId(listed.find((module) => module.enabled)?.id ?? "");
        await refresh(session.csrf);
        if (!cancelled) setReady(true);
      } catch (caught) {
        if (!cancelled)
          setError(caught instanceof Error ? caught.message : String(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    if (!ready || !moduleId) return;
    request<Summary>(`/api/summary?module=${encodeURIComponent(moduleId)}`)
      .then((value) => {
        if (!cancelled) setSummary(value);
      })
      .catch((caught) => {
        if (!cancelled)
          setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [moduleId, entities, ready]);
  async function action(work: () => Promise<void>, message?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      if (message) setNotice(message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }
  function navigate(next: Page, id?: string) {
    setPage(next);
    if (id) setModuleId(id);
    setQuery("");
    setFilter("all");
    setShowComparison(false);
    setMobileNav(false);
  }
  async function save(input: EntityInput, existing?: Entity) {
    const payload: SaveRequest = {
      entity: input,
      expectedVersion: existing?.version ?? 0,
      ...(existing ? { expectedNoteHash: existing.noteHash } : {}),
      operationId: crypto.randomUUID(),
    };
    const saved = await request<Entity>("/api/entities", payload);
    setEntities((previous) => [
      ...previous.filter((item) => item.id !== saved.id),
      saved,
    ]);
    try {
      await refresh();
    } catch (caught) {
      setError(
        `记录已保存，但刷新状态失败：${caught instanceof Error ? caught.message : String(caught)}`,
      );
    }
  }
  async function toggleDeleted(entity: Entity) {
    await action(
      async () => {
        await save(
          { ...entityInput(entity), deleted: !entity.deleted },
          entity,
        );
      },
      entity.deleted ? "记录已恢复。" : "记录已移入回收站，可随时恢复。",
    );
  }
  async function exportJson(path: string, name: string) {
    await action(async () => {
      const data = await request<unknown>(path);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "导出文件已准备好。请妥善保管包含本地记录的文件。");
  }
  const live = entities.filter((entity) => !entity.deleted);
  const counts = {
    plan: live.filter((entity) => entity.kind === "plan").length,
    fact: live.filter((entity) => entity.kind === "fact").length,
    inference: live.filter((entity) => entity.kind === "inference").length,
  };
  const visible = entities
    .filter(
      (entity) =>
        (includeDeleted || !entity.deleted) &&
        (page !== "module" || entity.module === moduleId) &&
        (filter === "all" || entity.kind === filter) &&
        (!query ||
          `${entity.title} ${entity.body} ${Object.values(entity.fields).join(" ")} ${modules.find((module) => module.id === entity.module)?.name ?? ""}`
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase())),
    )
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const pageTitle =
    page === "home"
      ? "生活总览"
      : page === "planner"
        ? "为生活留出余量"
        : page === "settings"
          ? "本地数据与设置"
          : (activeModule?.name ?? "模块");
  const pageSubtitle =
    page === "home"
      ? "把重要的事放在一起，让每一天更有方向。"
      : page === "planner"
        ? "先保护生活必需的时间，再安排目标。建议需要你确认。"
        : page === "settings"
          ? "数据由本机保存。每一次同步与恢复都可检查。"
          : "记录计划、观察事实，留下一段可以回看的生活。";
  const newEntity = () => {
    const module =
      page === "module"
        ? activeModule
        : (modules.find((item) => item.id === "planning") ?? modules[0]);
    if (module) setEditor({ module });
  };
  const specialistProps = {
    request,
    run: action,
    busy,
    entities,
    onImported: refresh,
    onOpen: (id: string) => {
      const entity = entities.find((item) => item.id === id);
      const module = modules.find((item) => item.id === entity?.module);
      if (entity && module) setEditor({ module, entity });
      else setError(`来源记录不可用：${id}`);
    },
  };
  return (
    <div className="app-shell">
      <aside
        className={`sidebar ${mobileNav ? "is-open" : ""}`}
        aria-label="主导航"
      >
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            navigate("home");
          }}
        >
          <span className="brand-mark">
            L<span>·</span>
          </span>
          <span>
            Life OS<small>自己的生活，自己的节奏</small>
          </span>
        </a>
        <div className="sidebar-section-label">我的空间</div>
        <button
          aria-label="生活总览"
          className={`nav-button ${page === "home" ? "selected" : ""}`}
          onClick={() => navigate("home")}
        >
          <span>▦</span>生活总览
        </button>
        <button
          aria-label="时间规划"
          className={`nav-button ${page === "planner" ? "selected" : ""}`}
          onClick={() => navigate("planner")}
        >
          <span>◷</span>时间规划<span className="nav-tag">本地规则</span>
        </button>
        <div className="sidebar-section-label domain-label">
          生活领域 <span>{modules.length}</span>
        </div>
        <nav>
          {modules.map((module) => (
            <button
              key={module.id}
              aria-label={module.name}
              className={`nav-button ${page === "module" && moduleId === module.id ? "selected" : ""}`}
              onClick={() => navigate("module", module.id)}
            >
              <span className="module-symbol">{symbols[module.id] ?? "◇"}</span>
              {module.name}
              <span className="nav-count">
                {live.filter((entity) => entity.module === module.id).length}
              </span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            aria-label="数据与设置"
            className={`nav-button ${page === "settings" ? "selected" : ""}`}
            onClick={() => navigate("settings")}
          >
            <span>⚙</span>数据与设置
            {conflicts.length > 0 && (
              <span className="nav-count warning-count">
                {conflicts.length}
              </span>
            )}
          </button>
          <div className="local-card">
            <i className="status-dot" />
            <div>
              本地优先<small>保存在自己的设备上</small>
            </div>
            <span>↗</span>
          </div>
          <p className="sidebar-footnote">用记录看见变化，用回顾找到方向。</p>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button
            className="mobile-menu icon-button"
            aria-label="展开导航"
            onClick={() => setMobileNav(!mobileNav)}
          >
            ☰
          </button>
          <div className="breadcrumb">
            我的空间 <span>/</span> {pageTitle}
          </div>
          <div className="topbar-right">
            <span className="local-pill">
              <i className="status-dot" />
              {ready ? "本地服务已连接" : "连接本地服务"}
            </span>
            <span className="avatar">我</span>
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {page === "home"
                  ? "A LITTLE MORE INTENTIONAL"
                  : page === "planner"
                    ? "MAKE ROOM FOR LIFE"
                    : page === "settings"
                      ? "YOUR DATA, YOUR CONTROL"
                      : "ONE AREA, SMALL STEPS"}
              </p>
              <h1>{pageTitle}</h1>
              <p className="page-subtitle">{pageSubtitle}</p>
            </div>
            {page !== "planner" && page !== "settings" && (
              <button
                className="button primary"
                disabled={!ready || busy || !modules.length}
                onClick={newEntity}
              >
                <span>＋</span> 新建记录
              </button>
            )}
          </div>
          {error && (
            <div className="message error" role="alert">
              <span>{error}</span>
              <button className="text-button" onClick={() => setError("")}>
                关闭
              </button>
            </div>
          )}
          {notice && (
            <div className="message success" role="status">
              {notice}
            </div>
          )}
          {!ready ? (
            <div className="empty-state">
              <span className="empty-symbol">◌</span>
              <h2>{error ? "本地服务暂不可用" : "正在打开你的空间"}</h2>
              <p>
                {error
                  ? "请确认本地服务正在运行。界面会保留错误信息。"
                  : "正在读取模块和本机记录…"}
              </p>
              {error && (
                <button
                  className="button"
                  onClick={() => window.location.reload()}
                >
                  重新连接
                </button>
              )}
            </div>
          ) : (
            <>
              {page === "home" && (
                <>
                  <div className="overview-grid">
                    <section className="welcome-card">
                      <div className="welcome-copy">
                        <span className="welcome-date">
                          {new Date().toLocaleDateString("zh-CN", {
                            month: "long",
                            day: "numeric",
                            weekday: "long",
                          })}
                        </span>
                        <h2>
                          慢慢来，
                          <br />
                          也在向前。
                        </h2>
                        <p>
                          计划是一种选择，记录是一种看见。
                          <br />
                          给目标留空间，也给生活留余量。
                        </p>
                        <button
                          className="button dark"
                          onClick={() => navigate("planner")}
                        >
                          安排一段时间 <span>↗</span>
                        </button>
                      </div>
                      <div className="growth-art" aria-hidden="true">
                        <div className="art-orbit orbit-one" />
                        <div className="art-orbit orbit-two" />
                        <div className="art-leaf leaf-one" />
                        <div className="art-leaf leaf-two" />
                        <div className="art-leaf leaf-three" />
                        <div className="art-stem" />
                        <div className="art-pot" />
                        <span className="art-spark spark-one">✦</span>
                        <span className="art-spark spark-two">＋</span>
                      </div>
                    </section>
                    <section className="snapshot-card">
                      <div className="section-heading">
                        <h2>此刻的记录</h2>
                        <span className="subtle">全部领域</span>
                      </div>
                      <div className="snapshot-total">
                        {live.length}
                        <span>条生活记录</span>
                      </div>
                      <div className="count-row">
                        {(["plan", "fact", "inference"] as const).map(
                          (kind) => (
                            <div key={kind}>
                              <span className={`kind-dot ${kind}`} />
                              <span>{kinds[kind]}</span>
                              <strong>{counts[kind]}</strong>
                            </div>
                          ),
                        )}
                      </div>
                      <p className="tiny-note">
                        推断是待确认的建议，完成计划后请另记事实。
                      </p>
                    </section>
                  </div>
                  <section className="domains-section">
                    <div className="section-heading">
                      <div>
                        <h2>
                          生活的{modules.length === 8 ? "八个" : "各个"}维度
                        </h2>
                        <p>从一个小记录开始，慢慢建立自己的系统。</p>
                      </div>
                      <span className="small-chip">
                        {modules.length} 个已启用模块
                      </span>
                    </div>
                    <div className="domain-grid">
                      {modules.map((module, index) => (
                        <button
                          key={module.id}
                          className="domain-card"
                          onClick={() => navigate("module", module.id)}
                        >
                          <div className={`domain-icon tone-${index % 4}`}>
                            {symbols[module.id] ?? "◇"}
                          </div>
                          <span className="domain-arrow">↗</span>
                          <h3>{module.name}</h3>
                          <p>
                            {module.entityTypes
                              .filter((type) => type.id !== "review")
                              .map((type) => type.name)
                              .slice(0, 2)
                              .join(" · ") || "记录与回顾"}
                          </p>
                          <footer>
                            <span>
                              {
                                live.filter(
                                  (entity) => entity.module === module.id,
                                ).length
                              }{" "}
                              条记录
                            </span>
                            <span>进入领域 →</span>
                          </footer>
                        </button>
                      ))}
                    </div>
                  </section>
                </>
              )}
              {(page === "home" || page === "module") && (
                <>
                  {page === "module" && moduleId === "finance" && (
                    <FinancePanel {...specialistProps} />
                  )}
                  {page === "module" && moduleId === "health" && (
                    <HealthPanel {...specialistProps} />
                  )}
                  {page === "module" &&
                    ["quant", "projects"].includes(moduleId) && (
                      <ResearchPanel
                        key={moduleId}
                        {...specialistProps}
                        moduleId={moduleId}
                      />
                    )}
                  {page === "module" && moduleId === "planning" && (
                    <ReviewPanel {...specialistProps} />
                  )}
                  <section className="records-section">
                    <div className="section-heading">
                      <div>
                        <h2>
                          {page === "home" ? "最近的生活记录" : "领域记录"}
                        </h2>
                        {page === "module" && (
                          <p>
                            {activeModule?.entityTypes.length ?? 0} 种记录类型 ·
                            模块 v{activeModule?.version}
                          </p>
                        )}
                      </div>
                      {page === "module" &&
                        activeModule?.entityTypes.some(
                          (type) => type.id === "review",
                        ) && (
                          <button
                            className="button"
                            onClick={() =>
                              setEditor({ module: activeModule, review: true })
                            }
                          >
                            ↺ 写一份回顾
                          </button>
                        )}
                    </div>
                    {page === "module" && summary && (
                      <div className="module-summary">
                        {(["plan", "fact", "inference"] as const).map(
                          (kind) => (
                            <div key={kind}>
                              <span className={`kind-dot ${kind}`} />
                              {kinds[kind]}
                              <strong>{summary.counts[kind]}</strong>
                            </div>
                          ),
                        )}
                        {Object.entries(summary.minutesByLanguage ?? {}).map(
                          ([language, minutes]) => (
                            <div key={language} className="language-total">
                              {language} · 实际练习<strong>{minutes}</strong>
                              分钟
                            </div>
                          ),
                        )}
                        {summary.finance?.map((item, index) => (
                          <div key={index} className="finance-total">
                            {item.category} · {item.currency}
                            <strong>{item.total}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="records-toolbar">
                      <div
                        className="filter-tabs"
                        role="group"
                        aria-label="记录性质筛选"
                      >
                        {(["all", "plan", "fact", "inference"] as const).map(
                          (kind) => (
                            <button
                              key={kind}
                              className={filter === kind ? "active" : ""}
                              onClick={() => setFilter(kind)}
                            >
                              {kind === "all" ? "全部" : kinds[kind]}
                            </button>
                          ),
                        )}
                      </div>
                      <div className="record-tools">
                        <label className="search-box">
                          <span aria-hidden="true">⌕</span>
                          <input
                            aria-label="搜索记录"
                            placeholder="搜索标题、笔记或字段…"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                          />
                        </label>
                        <div className="view-toggle" aria-label="切换视图">
                          <button
                            aria-label="列表视图"
                            aria-pressed={view === "list"}
                            className={view === "list" ? "active" : ""}
                            onClick={() => setView("list")}
                          >
                            ▤
                          </button>
                          <button
                            aria-label="时间线视图"
                            aria-pressed={view === "timeline"}
                            className={view === "timeline" ? "active" : ""}
                            onClick={() => setView("timeline")}
                          >
                            ◷
                          </button>
                        </div>
                      </div>
                    </div>
                    {page === "module" && activeModule && (
                      <div className="comparison-toggle">
                        <button
                          className="text-button"
                          aria-expanded={showComparison}
                          onClick={() => setShowComparison(!showComparison)}
                        >
                          {showComparison ? "收起比较" : "⇄ 比较两条记录"}
                        </button>
                        <span>计划与实际、不同实验，都可以并排核对。</span>
                      </div>
                    )}
                    {page === "module" && activeModule && showComparison && (
                      <Comparison
                        key={activeModule.id}
                        module={activeModule}
                        entities={entities.filter(
                          (entity) =>
                            entity.module === moduleId && !entity.deleted,
                        )}
                      />
                    )}
                    <div className="records-caption">
                      <span>
                        {visible.length} 条{query ? "匹配的" : ""}记录
                      </span>
                      <label>
                        <input
                          type="checkbox"
                          checked={includeDeleted}
                          onChange={(event) =>
                            setIncludeDeleted(event.target.checked)
                          }
                        />{" "}
                        显示回收站
                      </label>
                    </div>
                    {!visible.length ? (
                      <div className="empty-state compact">
                        <span className="empty-symbol">▤</span>
                        <h3>
                          {query ? "还没有匹配的记录" : "给这个空间写下第一笔"}
                        </h3>
                        <p>
                          {query
                            ? "试试其他关键词，或调整筛选条件。"
                            : "可以写一个计划、记录一次实践，或留下今天的回顾。"}
                        </p>
                        {!query && (
                          <button className="button" onClick={newEntity}>
                            ＋ 新建记录
                          </button>
                        )}
                      </div>
                    ) : (
                      <div
                        className={`record-list ${view === "timeline" ? "timeline" : ""}`}
                      >
                        {visible.map((entity) => {
                          const module = modules.find(
                            (item) => item.id === entity.module,
                          );
                          return (
                            <article
                              className={`record-row ${entity.deleted ? "deleted" : ""}`}
                              key={entity.id}
                            >
                              {view === "timeline" && (
                                <div className="timeline-date">
                                  {shortDate(entity.occurredAt)}
                                </div>
                              )}
                              <button
                                className="record-main"
                                onClick={() =>
                                  module && setEditor({ module, entity })
                                }
                              >
                                <span
                                  className={`record-type-icon ${entity.kind}`}
                                >
                                  {entity.type === "review"
                                    ? "↺"
                                    : (symbols[entity.module] ?? "◇")}
                                </span>
                                <div className="record-text">
                                  <div className="record-title">
                                    <h3>{entity.title}</h3>
                                    {entity.deleted && (
                                      <span className="deleted-label">
                                        回收站
                                      </span>
                                    )}
                                  </div>
                                  <p>
                                    {module?.name} <span>·</span>{" "}
                                    {module?.entityTypes.find(
                                      (type) => type.id === entity.type,
                                    )?.name ?? entity.type}{" "}
                                    {entity.body && (
                                      <>
                                        <span>·</span>{" "}
                                        {entity.body
                                          .slice(0, 66)
                                          .replace(/\n/g, " ")}
                                      </>
                                    )}
                                  </p>
                                </div>
                                <span className={`kind-badge ${entity.kind}`}>
                                  {kinds[entity.kind]}
                                </span>
                                <span
                                  className={`status-label status-${entity.status}`}
                                >
                                  {statuses[entity.status]}
                                </span>
                                {view === "list" && (
                                  <time>{shortDate(entity.occurredAt)}</time>
                                )}
                                <span className="row-arrow">›</span>
                              </button>
                              {entity.deleted && (
                                <button
                                  disabled={busy}
                                  className="text-button restore-button"
                                  onClick={() => void toggleDeleted(entity)}
                                >
                                  恢复
                                </button>
                              )}
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </>
              )}
              {page === "planner" && (
                <>
                  <Planner
                    busy={busy}
                    request={request}
                    run={action}
                    onAccepted={refresh}
                  />
                  <PeriodPlanner {...specialistProps} />
                </>
              )}
              {page === "settings" && (
                <>
                  <div className="settings-grid">
                    <section className="panel">
                      <span className="panel-symbol">⌂</span>
                      <h2>本机是数据的起点</h2>
                      <p>
                        记录保存在本地服务的数据目录中。这里的同步是本地 JSON
                        包的导出与导入，用于验证变更和冲突处理。
                      </p>
                      <dl className="status-list">
                        {Object.entries(status).map(([key, value]) => (
                          <React.Fragment key={key}>
                            <dt>
                              {(
                                {
                                  mode: "运行模式",
                                  sync: "同步状态",
                                  watch: "设备采集",
                                  trading: "交易功能",
                                  ai: "建议引擎",
                                } as Record<string, string>
                              )[key] ?? key}
                            </dt>
                            <dd>
                              {typeof value === "string"
                                ? value
                                : JSON.stringify(value)}
                            </dd>
                          </React.Fragment>
                        ))}
                      </dl>
                    </section>
                    <section className="panel">
                      <span className="panel-symbol">↓</span>
                      <h2>备份与模拟同步</h2>
                      <p>
                        备份和同步包可能包含你的完整记录与笔记，请仅在你信任的位置保存和交换。
                      </p>
                      <div className="settings-actions">
                        <button
                          className="button"
                          disabled={busy}
                          onClick={() =>
                            void exportJson(
                              "/api/backup",
                              `life-os-backup-${today()}.json`,
                            )
                          }
                        >
                          ↓ 导出完整备份
                        </button>
                        <button
                          className="button"
                          disabled={busy}
                          onClick={() =>
                            void exportJson(
                              "/api/sync/export?cursor=0",
                              `life-os-sync-${today()}.json`,
                            )
                          }
                        >
                          ↓ 导出同步包
                        </button>
                        <label
                          className={`button file-button ${busy ? "disabled" : ""}`}
                        >
                          ↑ 导入同步包
                          <input
                            type="file"
                            accept="application/json,.json"
                            disabled={busy}
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              event.target.value = "";
                              if (file)
                                void action(async () => {
                                  const packet: unknown = JSON.parse(
                                    await file.text(),
                                  );
                                  await request("/api/sync/import", { packet });
                                  await refresh();
                                }, "同步包已处理。若有冲突，请在下方核对后选择。");
                            }}
                          />
                        </label>
                      </div>
                      <div className="source-import">
                        <h3>手动导入来源记录</h3>
                        <p>
                          使用你手动导出的单条 EntityInput JSON
                          文件或合成样例，包含来源 namespace、recordId、revision
                          和导入模式。此操作不会连接手表或其他设备。
                        </p>
                        <label
                          className={`button file-button ${busy ? "disabled" : ""}`}
                        >
                          ↑ 导入源记录 JSON
                          <input
                            aria-label="导入源记录 JSON"
                            type="file"
                            accept="application/json,.json"
                            disabled={busy}
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              event.target.value = "";
                              if (file)
                                void action(async () => {
                                  const entity: unknown = JSON.parse(
                                    await file.text(),
                                  );
                                  await request("/api/import/source", {
                                    entity,
                                  });
                                  await refresh();
                                }, "源记录文件已处理，设备连接状态未改变。");
                            }}
                          />
                        </label>
                      </div>
                      <div className="demo-section">
                        <h3>想先看看示例？</h3>
                        <p>加入明确标记的虚构示例，了解各领域的记录方式。</p>
                        <button
                          className="button"
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              await request("/api/demo", {});
                              await refresh();
                            }, "虚构示例已加入。你可以编辑或移入回收站。")
                          }
                        >
                          加入虚构示例
                        </button>
                      </div>
                    </section>
                  </div>
                  <SyncTools {...specialistProps} />
                  <PluginTools {...specialistProps} />
                  <section className="panel conflict-panel">
                    <div className="section-heading">
                      <div>
                        <h2>
                          待处理的同步冲突{" "}
                          <span className="small-chip">{conflicts.length}</span>
                        </h2>
                        <p>
                          选择前核对两份内容。系统不会自动覆盖存在冲突的记录。
                        </p>
                      </div>
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() =>
                          void action(() => refresh(), "本地状态已刷新。")
                        }
                      >
                        刷新状态
                      </button>
                    </div>
                    {!conflicts.length ? (
                      <div className="quiet-state">
                        ✓ 目前没有待处理的冲突。
                      </div>
                    ) : (
                      conflicts.map((conflict) => (
                        <div className="conflict-card" key={conflict.id}>
                          <p className="conflict-reason">{conflict.reason}</p>
                          <div className="conflict-columns">
                            {(
                              [
                                {
                                  label: "当前本地版本",
                                  value: conflict.local,
                                  choice: "local",
                                },
                                {
                                  label: "传入版本",
                                  value: conflict.operation.value,
                                  choice: "incoming",
                                },
                              ] as const
                            ).map((item) => (
                              <div key={item.choice}>
                                <h3>{item.label}</h3>
                                <strong>
                                  {item.value?.title ?? "当前无本地记录"}
                                </strong>
                                <p>
                                  {item.value
                                    ? `${kinds[item.value.kind]} · 版本 ${item.value.version} · ${item.value.deleted ? "已删除" : "未删除"}`
                                    : "保留本地空状态"}
                                </p>
                                <pre>{item.value?.markdown ?? ""}</pre>
                                <details>
                                  <summary>查看字段与关联</summary>
                                  <pre>
                                    {JSON.stringify(
                                      {
                                        fields: item.value?.fields,
                                        relations: item.value?.relations,
                                      },
                                      null,
                                      2,
                                    )}
                                  </pre>
                                </details>
                                <button
                                  className="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void action(async () => {
                                      await request(
                                        `/api/conflicts/${encodeURIComponent(conflict.id)}`,
                                        {
                                          choice: item.choice,
                                          expectedVersion:
                                            conflict.local?.version ?? 0,
                                        },
                                      );
                                      await refresh();
                                    }, "冲突已按你的选择处理。")
                                  }
                                >
                                  采用
                                  {item.choice === "local" ? "本地" : "传入"}
                                  版本
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </section>
                </>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>Life OS · 把生活过成自己的样子</span>
            <span>本地优先 · 人工确认 · 可追溯记录</span>
          </footer>
        </div>
      </main>
      {mobileNav && (
        <button
          className="nav-backdrop"
          aria-label="关闭导航"
          onClick={() => setMobileNav(false)}
        />
      )}
      {editor && (
        <Editor
          key={
            editor.entity?.id ??
            `${editor.module.id}-${editor.review ? "review" : "new"}`
          }
          module={editor.module}
          existing={editor.entity}
          review={editor.review}
          entities={entities}
          busy={busy}
          onClose={() => setEditor(null)}
          onSave={async (input) => {
            await save(input, editor.entity);
            setEditor(null);
            setNotice(editor.entity ? "记录已保存。" : "记录已创建。");
          }}
          onDelete={async () => {
            if (editor.entity) {
              await save(
                {
                  ...entityInput(editor.entity),
                  deleted: !editor.entity.deleted,
                },
                editor.entity,
              );
              setEditor(null);
              setNotice(
                editor.entity.deleted ? "记录已恢复。" : "记录已移入回收站。",
              );
            }
          }}
          run={action}
        />
      )}
    </div>
  );
}

function Comparison({
  module,
  entities,
}: {
  module: Module;
  entities: Entity[];
}) {
  const [ids, setIds] = useState<[string, string]>(["", ""]);
  const selected = ids.map((id) => entities.find((entity) => entity.id === id));
  const fields = Array.from(
    new Set(selected.flatMap((entity) => Object.keys(entity?.fields ?? {}))),
  );
  const fieldLabel = (key: string) =>
    module.entityTypes
      .flatMap((type) => type.fields)
      .find((field) => field.key === key)?.label ?? key;
  const rows: { label: string; values: React.ReactNode[] }[] = [
    { label: "标题", values: selected.map((entity) => entity?.title ?? "—") },
    {
      label: "记录类型",
      values: selected.map(
        (entity) =>
          module.entityTypes.find((type) => type.id === entity?.type)?.name ??
          "—",
      ),
    },
    {
      label: "记录性质",
      values: selected.map((entity) =>
        entity ? (
          <span className={`kind-badge ${entity.kind}`}>
            {kinds[entity.kind]}
          </span>
        ) : (
          "—"
        ),
      ),
    },
    {
      label: "状态",
      values: selected.map((entity) =>
        entity ? statuses[entity.status] : "—",
      ),
    },
    {
      label: "发生时间",
      values: selected.map((entity) =>
        entity ? `${shortDate(entity.occurredAt)} · ${entity.timeZone}` : "—",
      ),
    },
    ...fields.map((key) => ({
      label: fieldLabel(key),
      values: selected.map((entity) => String(entity?.fields[key] ?? "—")),
    })),
    {
      label: "来源",
      values: selected.map((entity) =>
        entity ? <pre>{JSON.stringify(entity.source, null, 2)}</pre> : "—",
      ),
    },
    { label: "版本", values: selected.map((entity) => entity?.version ?? "—") },
    {
      label: "正文（Markdown 源文本）",
      values: selected.map((entity) => <pre>{entity?.body || "—"}</pre>),
    },
  ];
  return (
    <section className="comparison-panel" aria-label="记录比较">
      <div className="section-heading">
        <h3>并排比较</h3>
        <span className="small-chip">只读核对</span>
      </div>
      <div className="form-grid">
        {ids.map((id, index) => (
          <label className="form-field" key={index}>
            记录 {index === 0 ? "A" : "B"}
            <select
              aria-label={`记录 ${index === 0 ? "A" : "B"}`}
              value={id}
              onChange={(event) =>
                setIds((previous) =>
                  index === 0
                    ? [event.target.value, previous[1]]
                    : [previous[0], event.target.value],
                )
              }
            >
              <option value="">选择一条记录</option>
              {entities
                .filter((entity) => entity.id !== ids[index === 0 ? 1 : 0])
                .map((entity) => (
                  <option value={entity.id} key={entity.id}>
                    {entity.title} · {kinds[entity.kind]}
                  </option>
                ))}
            </select>
          </label>
        ))}
      </div>
      {selected.every(Boolean) ? (
        <div className="comparison-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">比较项目</th>
                <th scope="col">记录 A</th>
                <th scope="col">记录 B</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.label}-${index}`}>
                  <th scope="row">{row.label}</th>
                  {row.values.map((value, i) => (
                    <td key={i}>{value}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="form-help comparison-help">
          选择两条记录，即可查看字段、来源和正文的差异。
        </p>
      )}
    </section>
  );
}

type Run = (work: () => Promise<void>, message?: string) => Promise<void>;
function Editor({
  module,
  existing,
  review,
  entities,
  busy,
  onClose,
  onSave,
  onDelete,
  run,
}: {
  module: Module;
  existing?: Entity;
  review?: boolean;
  entities: Entity[];
  busy: boolean;
  onClose: () => void;
  onSave: (input: EntityInput) => Promise<void>;
  onDelete: () => Promise<void>;
  run: Run;
}) {
  const [input, setInput] = useState<EntityInput>(
    existing
      ? entityInput(existing)
      : {
          module: module.id,
          type: review ? "review" : (module.entityTypes[0]?.id ?? ""),
          title: "",
          kind: review ? "fact" : "plan",
          status: "draft",
          occurredAt: new Date().toISOString(),
          timeZone: zone(),
          fields: {},
          relations: [],
          body: "",
        },
  );
  const [formError, setFormError] = useState("");
  const type = module.entityTypes.find((item) => item.id === input.type);
  function update<K extends keyof EntityInput>(key: K, value: EntityInput[K]) {
    setInput((previous) => ({ ...previous, [key]: value }));
  }
  function fieldValue(field: Field, value: string) {
    setInput((previous) => {
      const fields = { ...previous.fields };
      if (value === "") delete fields[field.key];
      else fields[field.key] = field.type === "number" ? Number(value) : value;
      return { ...previous, fields };
    });
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError("");
    if (!input.title.trim()) {
      setFormError("请填写记录标题。");
      return;
    }
    if (!type) {
      setFormError("请选择有效的记录类型。");
      return;
    }
    void run(async () => {
      try {
        await onSave({ ...input, title: input.title.trim() });
      } catch (caught) {
        setFormError(caught instanceof Error ? caught.message : String(caught));
        throw caught;
      }
    });
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", handler);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = previous;
    };
  }, [busy, onClose]);
  return (
    <div className="modal-backdrop">
      <section
        className="editor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
      >
        <div className="editor-header">
          <div>
            <p className="eyebrow">{module.name}</p>
            <h2 id="editor-title">
              {existing ? "编辑记录" : review ? "写一份回顾" : "新建记录"}
            </h2>
          </div>
          <button
            className="icon-button"
            aria-label="关闭编辑"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="editor-body">
            {existing && (
              <div className="editor-meta">
                版本 {existing.version} · 类型与性质保持记录身份 · 更新于{" "}
                {shortDate(existing.updatedAt)}
                {existing.deleted ? " · 当前在回收站" : ""}
              </div>
            )}
            {formError && (
              <div className="message error" role="alert">
                {formError}
              </div>
            )}
            <label className="form-field full">
              标题
              <input
                autoFocus
                required
                maxLength={300}
                placeholder={
                  review ? "这段时间，我看见了什么？" : "写下你想记录的事…"
                }
                value={input.title}
                onChange={(event) => update("title", event.target.value)}
              />
            </label>
            <div className="form-grid">
              <label className="form-field">
                记录类型
                <select
                  aria-label="记录类型"
                  disabled={!!existing}
                  value={input.type}
                  onChange={(event) =>
                    setInput((previous) => ({
                      ...previous,
                      type: event.target.value,
                      fields: {},
                    }))
                  }
                >
                  {module.entityTypes.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                记录性质
                <select
                  aria-label="记录性质"
                  disabled={!!existing}
                  value={input.kind}
                  onChange={(event) =>
                    update("kind", event.target.value as Entity["kind"])
                  }
                >
                  {Object.entries(kinds).map(([id, name]) => (
                    <option value={id} key={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                状态
                <select
                  aria-label="状态"
                  value={input.status}
                  onChange={(event) =>
                    update("status", event.target.value as Entity["status"])
                  }
                >
                  {Object.entries(statuses).map(([id, name]) => (
                    <option value={id} key={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                发生时间
                <input
                  type="datetime-local"
                  required
                  value={localTime(input.occurredAt)}
                  onChange={(event) => {
                    if (event.target.value)
                      update(
                        "occurredAt",
                        new Date(event.target.value).toISOString(),
                      );
                  }}
                />
              </label>
              <label className="form-field full">
                记录时区
                <input
                  required
                  value={input.timeZone}
                  onChange={(event) => update("timeZone", event.target.value)}
                  placeholder="Asia/Shanghai"
                />
              </label>
            </div>
            <div className={`kind-explanation ${input.kind}`}>
              {input.kind === "plan"
                ? "计划记录想做的事。状态变为已完成后，也需要单独记录实际发生的事实。"
                : input.kind === "fact"
                  ? "事实记录实际发生或已观察到的内容，请避免把未经确认的建议写成事实。"
                  : "推断记录假设、估计或建议，确认之前请保留它的推断性质。"}
            </div>
            {type && type.fields.length > 0 && (
              <>
                <h3 className="form-section-title">{type.name}详情</h3>
                <div className="form-grid">
                  {type.fields.map((field) => (
                    <label className="form-field" key={field.key}>
                      {field.label}
                      {field.required && (
                        <span className="required-mark"> *</span>
                      )}
                      {field.type === "select" ? (
                        <select
                          aria-label={field.label}
                          required={field.required}
                          value={input.fields[field.key] ?? ""}
                          onChange={(event) =>
                            fieldValue(field, event.target.value)
                          }
                        >
                          <option value="">请选择</option>
                          {field.options?.map((option) => (
                            <option value={option} key={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          aria-label={field.label}
                          required={field.required}
                          type={
                            field.type === "date"
                              ? "date"
                              : field.type === "number"
                                ? "number"
                                : "text"
                          }
                          inputMode={
                            field.type === "decimal" ? "decimal" : undefined
                          }
                          min={field.min}
                          step={field.type === "number" ? "any" : undefined}
                          value={input.fields[field.key] ?? ""}
                          onChange={(event) =>
                            fieldValue(field, event.target.value)
                          }
                        />
                      )}
                    </label>
                  ))}
                </div>
              </>
            )}
            <h3 className="form-section-title">关联记录</h3>
            {!module.relations.length ? (
              <p className="form-help">此模块暂未声明可用的关联类型。</p>
            ) : (
              module.relations.map((relation) => {
                const targets = entities.filter(
                  (entity) =>
                    !entity.deleted &&
                    entity.id !== existing?.id &&
                    (relation.targetModules.includes("*") ||
                      relation.targetModules.includes(entity.module)),
                );
                const selected = input.relations
                  .filter((item) => item.type === relation.id)
                  .map((item) => item.target);
                const missing = selected.filter(
                  (id) => !targets.some((entity) => entity.id === id),
                );
                return (
                  <label
                    className="form-field full relation-field"
                    key={relation.id}
                  >
                    {relation.name}
                    <select
                      aria-label={relation.name}
                      multiple
                      value={selected}
                      onChange={(event) => {
                        const picked = Array.from(
                          event.target.selectedOptions,
                        ).map((option) => ({
                          type: relation.id,
                          target: option.value,
                        }));
                        if (relation.max && picked.length > relation.max) {
                          setFormError(
                            `「${relation.name}」最多关联 ${relation.max} 条记录。`,
                          );
                          return;
                        }
                        update("relations", [
                          ...input.relations.filter(
                            (item) => item.type !== relation.id,
                          ),
                          ...picked,
                        ]);
                      }}
                    >
                      {targets.map((entity) => (
                        <option value={entity.id} key={entity.id}>
                          {entity.title} · {kinds[entity.kind]}
                        </option>
                      ))}
                      {missing.map((id) => (
                        <option value={id} key={id}>
                          保留已有引用：{id}
                        </option>
                      ))}
                    </select>
                    <span className="form-help">
                      {targets.length
                        ? "按住 Ctrl / ⌘ 可选择多条。"
                        : "暂无可关联记录。先在目标领域创建记录。"}
                      {relation.max ? ` 最多 ${relation.max} 条。` : ""}
                    </span>
                  </label>
                );
              })
            )}
            <label className="form-field full markdown-field">
              {input.type === "review" ? "回顾内容" : "笔记"}
              <span className="markdown-tag">Markdown 源文本</span>
              <textarea
                aria-label={input.type === "review" ? "回顾内容" : "笔记"}
                rows={7}
                placeholder={
                  input.type === "review"
                    ? "## 发生了什么\n\n## 哪些做法有效\n\n## 下一步行动"
                    : "可以写下背景、过程和下一步…"
                }
                value={input.body}
                onChange={(event) => update("body", event.target.value)}
              />
              <span className="form-help">
                按原文保存，支持 Markdown 写作；界面不执行笔记中的 HTML。
              </span>
            </label>
          </div>
          <div className="editor-footer">
            {existing && (
              <button
                className="text-button danger"
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    try {
                      await onDelete();
                    } catch (caught) {
                      setFormError(
                        caught instanceof Error
                          ? caught.message
                          : String(caught),
                      );
                      throw caught;
                    }
                  })
                }
              >
                {existing.deleted ? "恢复记录" : "移入回收站"}
              </button>
            )}
            <div>
              <button
                className="button"
                type="button"
                disabled={busy}
                onClick={onClose}
              >
                取消
              </button>
              <button className="button primary" type="submit" disabled={busy}>
                {busy ? "正在保存…" : "保存记录"}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

function Planner({
  busy,
  request,
  run,
  onAccepted,
}: {
  busy: boolean;
  request: <T>(path: string, body?: unknown) => Promise<T>;
  run: Run;
  onAccepted: () => Promise<void>;
}) {
  const [input, setInput] = useState<PlanInput>({
    date: today(),
    timeZone: zone(),
    scenario: "normal",
    startMinute: 480,
    endMinute: 1320,
    protected: [],
    buffers: { meals: 0, commute: 0, preparation: 0, recovery: 0, sleep: 0 },
    goals: [
      { id: crypto.randomUUID(), title: "示例目标（请修改）", minutes: 30 },
    ],
  });
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [localError, setLocalError] = useState("");
  const bufferLabels: Record<keyof PlanInput["buffers"], string> = {
    meals: "用餐",
    commute: "通勤",
    preparation: "准备",
    recovery: "恢复",
    sleep: "睡眠",
  };
  function change(next: PlanInput) {
    setInput(next);
    setDraft(null);
    setAccepted(false);
    setLocalError("");
  }
  function minuteControl(
    label: string,
    value: number,
    onChange: (minute: number) => void,
  ) {
    return <MinuteField label={label} value={value} onChange={onChange} />;
  }
  return (
    <div className="planner-layout">
      <section className="panel planner-input">
        <div className="section-heading">
          <h2>规划输入</h2>
          <span className="small-chip">可编辑示范</span>
        </div>
        <p className="form-help planner-intro">
          以下初始时间仅演示输入方式，未读取你的真实作息。请按实际情况修改；预留分钟数初始为
          0，需要你填写。
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setLocalError("");
            if (input.startMinute >= input.endMinute) {
              setLocalError("规划结束时间必须晚于开始时间。");
              return;
            }
            void run(async () => {
              const result = await request<PlanDraft>("/api/plan", input);
              setDraft(result);
              setAccepted(false);
            });
          }}
        >
          <div className="form-grid">
            <label className="form-field">
              规划日期
              <input
                type="date"
                required
                value={input.date}
                onChange={(event) =>
                  change({ ...input, date: event.target.value })
                }
              />
            </label>
            <label className="form-field">
              当日情境
              <select
                aria-label="当日情境"
                value={input.scenario}
                onChange={(event) =>
                  change({
                    ...input,
                    scenario: event.target.value as PlanInput["scenario"],
                  })
                }
              >
                <option value="normal">普通日</option>
                <option value="overtime">加班日</option>
                <option value="fatigue">疲劳日</option>
              </select>
            </label>
            {minuteControl("规划开始", input.startMinute, (value) =>
              change({ ...input, startMinute: value }),
            )}
            {minuteControl("规划结束", input.endMinute, (value) =>
              change({ ...input, endMinute: value }),
            )}
            <label className="form-field full">
              时区
              <input
                required
                value={input.timeZone}
                onChange={(event) =>
                  change({ ...input, timeZone: event.target.value })
                }
              />
            </label>
          </div>
          <div className="section-heading form-section-title">
            <h3>保护时间段</h3>
            <button
              className="text-button"
              type="button"
              onClick={() =>
                change({
                  ...input,
                  protected: [
                    ...input.protected,
                    { label: "", start: 720, end: 780 },
                  ],
                })
              }
            >
              ＋ 添加
            </button>
          </div>
          <p className="form-help">
            工作、睡眠、用餐或其他固定事项会先从可用时间中扣除。
          </p>
          {!input.protected.length && (
            <p className="quiet-inline">尚未设置保护时间段。</p>
          )}
          {input.protected.map((block, index) => (
            <div className="protected-row" key={index}>
              <label className="form-field">
                事项
                <input
                  required
                  placeholder="例如：工作 / 睡眠"
                  value={block.label}
                  onChange={(event) =>
                    change({
                      ...input,
                      protected: input.protected.map((item, i) =>
                        i === index
                          ? { ...item, label: event.target.value }
                          : item,
                      ),
                    })
                  }
                />
              </label>
              {minuteControl("开始", block.start, (value) =>
                change({
                  ...input,
                  protected: input.protected.map((item, i) =>
                    i === index ? { ...item, start: value } : item,
                  ),
                }),
              )}
              {minuteControl("结束", block.end, (value) =>
                change({
                  ...input,
                  protected: input.protected.map((item, i) =>
                    i === index ? { ...item, end: value } : item,
                  ),
                }),
              )}
              <button
                className="icon-button remove-row"
                type="button"
                aria-label={`移除保护时间段 ${index + 1}`}
                onClick={() =>
                  change({
                    ...input,
                    protected: input.protected.filter((_, i) => i !== index),
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
          <h3 className="form-section-title">
            额外预留时间 <span className="subtle">分钟</span>
          </h3>
          <p className="form-help">
            用于尚未放进固定时间段的事项，避免重复扣除同一段时间。
          </p>
          <div className="buffer-grid">
            {Object.entries(bufferLabels).map(([key, label]) => (
              <label className="form-field" key={key}>
                {label}
                <input
                  type="number"
                  min={0}
                  max={1440}
                  required
                  value={input.buffers[key as keyof PlanInput["buffers"]]}
                  onChange={(event) =>
                    change({
                      ...input,
                      buffers: {
                        ...input.buffers,
                        [key]: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
          <div className="section-heading form-section-title">
            <h3>想做的目标</h3>
            <button
              className="text-button"
              type="button"
              onClick={() =>
                change({
                  ...input,
                  goals: [
                    ...input.goals,
                    { id: crypto.randomUUID(), title: "", minutes: 30 },
                  ],
                })
              }
            >
              ＋ 添加
            </button>
          </div>
          {input.goals.map((goal, index) => (
            <div className="goal-row" key={goal.id}>
              <label className="form-field">
                目标
                <input
                  required
                  value={goal.title}
                  placeholder="一个具体的小目标"
                  onChange={(event) =>
                    change({
                      ...input,
                      goals: input.goals.map((item) =>
                        item.id === goal.id
                          ? { ...item, title: event.target.value }
                          : item,
                      ),
                    })
                  }
                />
              </label>
              <label className="form-field">
                所需分钟
                <input
                  type="number"
                  required
                  min={1}
                  max={1440}
                  value={goal.minutes}
                  onChange={(event) =>
                    change({
                      ...input,
                      goals: input.goals.map((item) =>
                        item.id === goal.id
                          ? { ...item, minutes: Number(event.target.value) }
                          : item,
                      ),
                    })
                  }
                />
              </label>
              <button
                type="button"
                className="icon-button remove-row"
                aria-label={`移除目标 ${index + 1}`}
                onClick={() =>
                  change({
                    ...input,
                    goals: input.goals.filter((item) => item.id !== goal.id),
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
          {localError && (
            <div className="message error" role="alert">
              {localError}
            </div>
          )}
          <button
            className="button primary planner-submit"
            type="submit"
            disabled={busy || !input.goals.length}
          >
            {busy ? "正在处理…" : "生成本地规则建议"} <span>→</span>
          </button>
        </form>
      </section>
      <section className="panel planner-output">
        <div className="section-heading">
          <h2>时间建议</h2>
          <span className="kind-badge inference">推断</span>
        </div>
        {!draft ? (
          <div className="empty-state">
            <span className="empty-symbol">◷</span>
            <h3>先为真实生活留白</h3>
            <p>
              填写固定事项、预留时间与目标后，
              <br />
              查看可以执行的安排。
            </p>
            <div className="planner-principles">
              <span>✓ 保护固定时间</span>
              <span>✓ 保留恢复空间</span>
              <span>✓ 由你确认计划</span>
            </div>
          </div>
        ) : (
          <>
            <p className="draft-meta">
              {draft.input.date} · {draft.input.timeZone} · {draft.ruleVersion}
            </p>
            {draft.issues.length > 0 && (
              <div className="message caution">
                <div>
                  {draft.issues.map((issue, index) => (
                    <p key={index}>{issue}</p>
                  ))}
                </div>
              </div>
            )}
            <div className="plan-slots">
              {draft.slots.length ? (
                draft.slots.map((slot, index) => (
                  <div className="plan-slot" key={`${slot.goalId}-${index}`}>
                    <time>
                      {minuteTime(slot.start)}
                      <span>{minuteTime(slot.end)}</span>
                    </time>
                    <div>
                      <h3>{slot.title}</h3>
                      <p>{slot.end - slot.start} 分钟 · 待人工确认</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="quiet-inline">当前约束下没有可安排的目标。</p>
              )}
            </div>
            {draft.unscheduled.length > 0 && (
              <div className="unscheduled">
                <h3>暂未安排</h3>
                {draft.unscheduled.map((goal) => (
                  <p key={goal.id}>
                    {draft.input.goals.find((item) => item.id === goal.id)
                      ?.title ?? goal.id}
                    <span>{goal.minutes} 分钟</span>
                  </p>
                ))}
              </div>
            )}
            <div className="accept-box">
              <p>
                确认后保存为「计划」记录。建议和计划均不代表目标已实际完成。
              </p>
              <button
                className="button primary"
                disabled={busy || accepted || !draft.slots.length}
                onClick={() =>
                  void run(async () => {
                    await request<Entity[]>("/api/plan/accept", { draft });
                    setAccepted(true);
                    await onAccepted();
                  }, "建议已确认并保存为计划，实际执行后请另记事实。")
                }
              >
                {accepted ? "✓ 已保存为计划" : "确认并保存为计划"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function MinuteField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (minute: number) => void;
}) {
  const [text, setText] = useState(minuteTime(value));
  useEffect(() => setText(minuteTime(value)), [value]);
  return (
    <label className="form-field">
      {label}
      <input
        required
        pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]|24:00"
        title="请输入 00:00 到 24:00 之间的时间"
        placeholder="HH:mm"
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$/.test(next))
            onChange(timeMinute(next));
        }}
        onFocus={(event) => event.target.select()}
      />
    </label>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
