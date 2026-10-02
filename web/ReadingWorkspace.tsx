import React, { useEffect, useState } from "react";
import type { Entity, Module } from "../src/types.js";
import type {
  CreateReadingMaterialInput,
  ReadingLanguage,
  ReadingReport,
  ReadingRights,
  ReadingSourceType,
} from "../src/reading.js";
import { LocalDateTimeField } from "./LocalDateTimeField.js";
import type { SpecialistProps } from "./SpecialistPanels.js";
export function browserNow(date = new Date()) {
  const offset = -date.getTimezoneOffset();
  const local = new Date(date.valueOf() + offset * 60000)
    .toISOString()
    .slice(0, 19);
  const absolute = Math.abs(offset);
  return `${local}${offset < 0 ? "-" : "+"}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}
export function readableTime(value: string, timeZone: string) {
  try {
    return (
      new Intl.DateTimeFormat("zh-CN", {
        timeZone,
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value)) + ` · ${timeZone}`
    );
  } catch {
    return value + ` · ${timeZone}`;
  }
}
export type ReadingUiProps = SpecialistProps & {
  modules: Module[];
  onCreateGoal?: (moduleId: string) => void;
  onShowTasks?: () => void;
};
export function ReadingSourceLink({
  id,
  entities,
  onOpen,
}: Pick<SpecialistProps, "entities" | "onOpen"> & { id: string }) {
  const entity = entities.find((item) => item.id === id);
  return entity ? (
    <button
      type="button"
      className="text-button source-link"
      title={id}
      onClick={() => onOpen(id)}
    >
      {entity.title}
    </button>
  ) : (
    <code className="source-id">{id}</code>
  );
}
export function GoalPicker({
  entities,
  modules,
  selected,
  onChange,
  label = "共同推进的目标",
}: Pick<ReadingUiProps, "entities" | "modules"> & {
  selected: string[];
  onChange: (ids: string[]) => void;
  label?: string;
}) {
  const goals = entities.filter(
    (entity) =>
      !entity.deleted &&
      entity.kind === "plan" &&
      ["goal", "language-goal", "direction"].includes(entity.type) &&
      entity.status === "active",
  );
  return (
    <fieldset className="goal-picker">
      <legend>{label} · 可多选</legend>
      {!goals.length ? (
        <p className="form-help">
          暂无活动目标。先创建你自己的领域或语言目标；系统不会自动添加考试、口语或法语目标。
        </p>
      ) : (
        goals.map((goal) => (
          <label className="check-field" key={goal.id}>
            <input
              type="checkbox"
              aria-label={`${goal.title} ${modules.find((module) => module.id === goal.module)?.name ?? goal.module}${goal.fields.language ? ` · ${goal.fields.language}` : ""}`}
              checked={selected.includes(goal.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, goal.id]
                    : selected.filter((id) => id !== goal.id),
                )
              }
            />
            <span>
              {goal.title}
              <small>
                {modules.find((module) => module.id === goal.module)?.name ??
                  goal.module}
                {goal.fields.language ? ` · ${goal.fields.language}` : ""}
              </small>
            </span>
          </label>
        ))
      )}
    </fieldset>
  );
}
type Upgrade = {
  module: string;
  name: string;
  fromVersion: string;
  toVersion: string;
  fromSchema: number;
  toSchema: number;
  compatible: boolean;
  reason?: string;
};
export function BuiltinUpgradePrompt(
  props: Pick<
    ReadingUiProps,
    "request" | "run" | "busy" | "onImported" | "modules"
  > & { requiredModules?: string[] },
) {
  const [pending, setPending] = useState<Upgrade[] | null>(null);
  const [results, setResults] = useState<
    {
      module: string;
      fromSchema: number;
      toSchema: number;
      backup?: string;
      alreadyCurrent: boolean;
    }[]
  >([]);
  return (
    <div className="builtin-upgrade" role="region" aria-label="学习功能升级">
      <h3>先检查学习功能升级</h3>
      <p className="form-help">
        现有数据需要明确升级后使用新功能。检查不会写入数据；确认迁移会保留备份，重试不会重复升级。自定义清单不自动覆盖。
      </p>
      <button
        className="button"
        disabled={props.busy}
        onClick={() =>
          void props.run(async () => {
            const result = await props.request<{ pending: Upgrade[] }>(
              "/api/builtin-upgrades",
            );
            setPending(result.pending);
          })
        }
      >
        检查内置学习升级
      </button>
      {pending && (
        <>
          {pending
            .filter(
              (item) =>
                !props.requiredModules ||
                props.requiredModules.includes(item.module),
            )
            .map((item) => (
              <article className="upgrade-card" key={item.module}>
                <h4>
                  {item.name} · Schema {item.fromSchema} → {item.toSchema}
                </h4>
                <p className="form-help">
                  v{item.fromVersion} → v{item.toVersion}
                  {item.reason ? ` · ${item.reason}` : ""}
                </p>
                <button
                  className="button"
                  disabled={props.busy || !item.compatible}
                  onClick={() =>
                    void props.run(async () => {
                      const result = await props.request<{
                        module: string;
                        fromSchema: number;
                        toSchema: number;
                        backup?: string;
                        alreadyCurrent: boolean;
                      }>("/api/builtin-upgrades", { module: item.module });
                      setResults((previous) => [...previous, result]);
                      await props.onImported();
                    }, "学习数据结构已升级，请检查保留的迁移备份。")
                  }
                >
                  确认升级 {item.name}
                </button>
              </article>
            ))}
          {!pending.length && (
            <p className="quiet-inline">
              内置清单已经是当前版本；若领域停用，请先在本地配置中启用。
            </p>
          )}
        </>
      )}
      {results.map((result, index) => (
        <p className="form-help" key={index}>
          {result.module}：
          {result.alreadyCurrent
            ? "已经是当前版本"
            : `已迁移 Schema ${result.fromSchema} → ${result.toSchema}`}
          {result.backup ? ` · 备份：${result.backup}` : ""}
        </p>
      ))}
    </div>
  );
}
function SafeReference({ reference }: { reference: string }) {
  let href = "";
  try {
    const url = new URL(reference);
    if (["http:", "https:"].includes(url.protocol)) href = url.href;
  } catch {
    /* Local references remain plain text. */
  }
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {reference}
    </a>
  ) : (
    <span>{reference}</span>
  );
}
export function ReadingWorkspace(props: ReadingUiProps) {
  const ready = ["learning", "languages"].every(
    (id) =>
      (props.modules.find((module) => module.id === id)?.schemaVersion ?? 0) >=
      2,
  );
  const [report, setReport] = useState<ReadingReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState("");
  const [materialInput, setMaterialInput] = useState<
    Omit<CreateReadingMaterialInput, "rights"> & { rights: ReadingRights | "" }
  >({
    operationId: crypto.randomUUID(),
    title: "",
    reference: "",
    sourceType: "技术文档",
    language: "英语",
    rights: "",
    body: "",
    occurredAt: browserNow(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  });
  const [materialSaved, setMaterialSaved] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [materialId, setMaterialId] = useState("");
  const [goalIds, setGoalIds] = useState<string[]>([]);
  const [minutes, setMinutes] = useState("");
  const [takeaway, setTakeaway] = useState("");
  const [sessionOperation, setSessionOperation] = useState(crypto.randomUUID());
  const [occurredAt, setOccurredAt] = useState(browserNow());
  const [sessionId, setSessionId] = useState("");
  const [explanation, setExplanation] = useState("");
  const [quote, setQuote] = useState("");
  const [explanationReference, setExplanationReference] = useState("");
  const [explanationOperation, setExplanationOperation] = useState(
    crypto.randomUUID(),
  );
  const [term, setTerm] = useState("");
  const [meaning, setMeaning] = useState("");
  const [context, setContext] = useState("");
  const [due, setDue] = useState("");
  const [vocabularyOperation, setVocabularyOperation] = useState(
    crypto.randomUUID(),
  );
  async function load() {
    setLoading(true);
    setReadError("");
    try {
      setReport(await props.request<ReadingReport>("/api/reports/reading"));
    } catch (error) {
      setReadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (ready) void load();
  }, [props.entities, ready]);
  const materials = report?.materials ?? [];
  const selectedMaterial = materials.find(
    (item) => item.entity.id === materialId,
  )?.entity;
  const sessions =
    report?.sessions.filter((item) => item.materialId === materialId) ?? [];
  function materialChange(change: Partial<CreateReadingMaterialInput>) {
    setMaterialInput((previous) => ({
      ...previous,
      ...(materialSaved ? { operationId: crypto.randomUUID() } : {}),
      ...change,
    }));
    setMaterialSaved(false);
  }
  const meta = { occurredAt, timeZone: materialInput.timeZone };
  return (
    <section
      className="panel specialist-panel reading-workspace"
      aria-label="共同阅读工作区"
    >
      <div className="section-heading">
        <div>
          <h2>一份材料，连接知识与语言</h2>
          <p>
            阅读优先，同一次阅读可以推进
            AI、金融知识和英日目标。分钟只记一次；解释、词汇与目标视角不叠加计时。
          </p>
        </div>
      </div>
      {!ready ? (
        <BuiltinUpgradePrompt {...props} />
      ) : (
        <>
          <div className="reading-guide">
            <p className="form-help">
              从你自己的目标开始，按需要推进，不必一次填完所有步骤。
            </p>
            <ol>
              <li>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => props.onCreateGoal?.("learning")}
                >
                  建立领域目标
                </button>
                {" / "}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => props.onCreateGoal?.("languages")}
                >
                  建立语言目标
                </button>
              </li>
              <li>保存有来源的材料</li>
              <li>关联目标，记录阅读</li>
              <li>留下解释与词汇</li>
              <li>
                <button
                  type="button"
                  className="text-button"
                  onClick={props.onShowTasks}
                >
                  在清单与回顾中继续推进
                </button>
              </li>
            </ol>
          </div>
          <details
            className="reading-main"
            open={workspaceOpen}
            onToggle={(event) => setWorkspaceOpen(event.currentTarget.open)}
          >
            <summary>
              材料与阅读记录{" "}
              <span className="subtle">
                {materials.length} 份材料 · {report?.uniqueTotalMinutes ?? 0}{" "}
                分钟
              </span>
            </summary>
            {loading && (
              <p className="quiet-inline" role="status">
                正在读取阅读记录…
              </p>
            )}
            {readError && (
              <div className="message error" role="alert">
                {readError}
                <button className="text-button" onClick={() => void load()}>
                  重试读取阅读
                </button>
              </div>
            )}
            <details className="manual-import" open={!materials.length}>
              <summary>保存一份材料原文</summary>
              <p className="form-help">
                粘贴原文或选择文字文件；引用链接只保存为来源，不自动抓取。原文与辅助解释分别保存。
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void props.run(async () => {
                    const entity = await props.request<Entity>(
                      "/api/reading/materials",
                      materialInput,
                    );
                    setMaterialId(entity.id);
                    setSessionId("");
                    setMaterialSaved(true);
                    await props.onImported();
                    await load();
                  }, "材料原文与来源已保存，可从来源编辑器核对。");
                }}
              >
                <div className="form-grid">
                  <label className="form-field">
                    材料标题
                    <input
                      aria-label="材料标题"
                      required
                      value={materialInput.title}
                      onChange={(event) =>
                        materialChange({ title: event.target.value })
                      }
                    />
                  </label>
                  <label className="form-field">
                    来源 URL 或引用
                    <input
                      aria-label="来源 URL 或引用"
                      required
                      value={materialInput.reference}
                      onChange={(event) =>
                        materialChange({ reference: event.target.value })
                      }
                      placeholder="原始链接、书页或本地文件引用"
                    />
                  </label>
                  <label className="form-field">
                    材料语言
                    <select
                      aria-label="材料语言"
                      value={materialInput.language}
                      onChange={(event) =>
                        materialChange({
                          language: event.target.value as ReadingLanguage,
                        })
                      }
                    >
                      <option value="英语">英语</option>
                      <option value="日语">日语</option>
                      <option value="法语">法语（可选）</option>
                    </select>
                  </label>
                  <label className="form-field">
                    来源类型
                    <select
                      aria-label="来源类型"
                      value={materialInput.sourceType}
                      onChange={(event) =>
                        materialChange({
                          sourceType: event.target.value as ReadingSourceType,
                        })
                      }
                    >
                      {[
                        "技术文档",
                        "新闻",
                        "剧相关文字",
                        "社交文字",
                        "其他",
                      ].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field full">
                    原文保存依据
                    <select
                      required
                      aria-label="原文保存依据"
                      value={materialInput.rights}
                      onChange={(event) =>
                        materialChange({
                          rights: event.target.value as ReadingRights,
                        })
                      }
                    >
                      <option value="">请选择保存依据</option>
                      {[
                        "本人创作",
                        "获准导入",
                        "公有领域",
                        "合法摘录",
                        "虚构样例",
                      ].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="form-field">
                  材料原文
                  <textarea
                    aria-label="材料原文"
                    required
                    value={materialInput.body}
                    onChange={(event) =>
                      materialChange({ body: event.target.value })
                    }
                    placeholder="保留你选择保存的原文，不在这里混入解释"
                  />
                </label>
                <div className="settings-actions">
                  <label className="button file-button">
                    选择原文文字文件
                    <input
                      type="file"
                      accept=".txt,.md,text/plain,text/markdown"
                      aria-label="选择原文文字文件"
                      disabled={props.busy}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file)
                          void props.run(async () =>
                            materialChange({ body: await file.text() }),
                          );
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="button"
                    onClick={() =>
                      materialChange({
                        title: "虚构样例 · 共享阅读与证据",
                        reference: "local:fictional-reading-example",
                        sourceType: "技术文档",
                        language: "英语",
                        rights: "虚构样例",
                        body: "A learning system connects goals to evidence. One reading session can support language and technical knowledge, while its time is counted once.",
                      })
                    }
                  >
                    填入明确虚构样例
                  </button>
                  <button
                    className="button primary"
                    disabled={props.busy || materialSaved}
                  >
                    {materialSaved ? "✓ 材料已保存" : "保存材料原文"}
                  </button>
                </div>
              </form>
            </details>
            {materials.length > 0 && (
              <>
                <label className="form-field">
                  当前阅读材料
                  <select
                    aria-label="当前阅读材料"
                    value={materialId}
                    onChange={(event) => {
                      setMaterialId(event.target.value);
                      setSessionId("");
                    }}
                  >
                    <option value="">请选择材料</option>
                    {materials.map(({ entity }) => (
                      <option key={entity.id} value={entity.id}>
                        {entity.title} · {entity.fields.language}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedMaterial && (
                  <article className="reading-material">
                    <div className="section-heading">
                      <h3>{selectedMaterial.title}</h3>
                      <ReadingSourceLink id={selectedMaterial.id} {...props} />
                    </div>
                    <p className="form-help">
                      {selectedMaterial.fields.language} ·{" "}
                      {selectedMaterial.fields.sourceType} ·{" "}
                      {selectedMaterial.fields.rights}
                    </p>
                    <p className="reading-reference">
                      <SafeReference
                        reference={String(
                          selectedMaterial.fields.reference ?? "",
                        )}
                      />
                    </p>
                    <details open>
                      <summary>原文（保持独立）</summary>
                      <pre className="reading-original">
                        {selectedMaterial.body}
                      </pre>
                    </details>
                  </article>
                )}
                {selectedMaterial && (
                  <form
                    className="reading-session-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void props.run(async () => {
                        const entity = await props.request<Entity>(
                          "/api/reading/sessions",
                          {
                            ...meta,
                            operationId: sessionOperation,
                            materialId,
                            minutes: Number(minutes),
                            goalIds,
                            takeaway,
                          },
                        );
                        setSessionId(entity.id);
                        setSessionOperation(crypto.randomUUID());
                        setMinutes("");
                        setTakeaway("");
                        await props.onImported();
                        await load();
                      }, "阅读已记录一次；多目标视角不会复制分钟。");
                    }}
                  >
                    <GoalPicker
                      {...props}
                      selected={goalIds}
                      onChange={setGoalIds}
                    />
                    <div className="form-grid">
                      <label className="form-field">
                        本次阅读分钟
                        <input
                          aria-label="本次阅读分钟"
                          type="number"
                          min="1"
                          required
                          value={minutes}
                          onChange={(event) => setMinutes(event.target.value)}
                        />
                      </label>
                      <LocalDateTimeField
                        label="阅读发生时间"
                        value={occurredAt}
                        onChange={setOccurredAt}
                        timeZone={materialInput.timeZone}
                        required
                      />
                      <label className="form-field full">
                        阅读时区
                        <input
                          aria-label="阅读时区"
                          required
                          value={materialInput.timeZone}
                          onChange={(event) =>
                            materialChange({ timeZone: event.target.value })
                          }
                        />
                      </label>
                      <label className="form-field full">
                        本次收获
                        <textarea
                          aria-label="本次收获"
                          value={takeaway}
                          onChange={(event) => setTakeaway(event.target.value)}
                        />
                      </label>
                    </div>
                    <button
                      className="button primary"
                      disabled={props.busy || !minutes || !occurredAt}
                    >
                      记录本次阅读
                    </button>
                  </form>
                )}
                {sessions.length > 0 && (
                  <div className="reading-session-history">
                    <h3 className="report-heading">这份材料的阅读记录</h3>
                    {sessions.map(({ entity, counted }) => (
                      <div className="reading-history-row" key={entity.id}>
                        <ReadingSourceLink id={entity.id} {...props} />
                        <span>
                          {entity.fields.minutes} 分钟
                          {!counted ? " · 未纳入统计，需核对" : ""}
                        </span>
                        <small>
                          {readableTime(entity.occurredAt, entity.timeZone)}
                        </small>
                      </div>
                    ))}
                    <label className="form-field">
                      解释与词汇关联的阅读
                      <select
                        aria-label="解释与词汇关联的阅读"
                        value={sessionId}
                        onChange={(event) => setSessionId(event.target.value)}
                      >
                        <option value="">
                          不关联本次记录（解释可单独保存）
                        </option>
                        {sessions.map(({ entity }) => (
                          <option key={entity.id} value={entity.id}>
                            {entity.title} · {entity.fields.minutes} 分钟 ·{" "}
                            {readableTime(entity.occurredAt, entity.timeZone)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                {selectedMaterial && (
                  <details className="manual-import">
                    <summary>辅助解释与词汇（不新增分钟）</summary>
                    <div className="reading-assistance">
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void props.run(async () => {
                            await props.request<Entity>(
                              "/api/reading/explanations",
                              {
                                ...meta,
                                operationId: explanationOperation,
                                materialId,
                                ...(sessionId ? { sessionId } : {}),
                                text: explanation,
                                quote,
                                reference: explanationReference,
                                goalIds,
                              },
                            );
                            setExplanationOperation(crypto.randomUUID());
                            setExplanation("");
                            setQuote("");
                            setExplanationReference("");
                            await props.onImported();
                            await load();
                          }, "辅助解释保存为待确认推断，原文与计时保持独立。");
                        }}
                      >
                        <h3>保存辅助解释</h3>
                        <p className="form-help">
                          手动填写你的理解或辅助解释来源。内容作为草稿推断，不自动调用付费
                          API，也不改写原文。
                        </p>
                        <label className="form-field">
                          原文引用片段
                          <input
                            aria-label="原文引用片段"
                            value={quote}
                            onChange={(event) => setQuote(event.target.value)}
                          />
                        </label>
                        <label className="form-field">
                          辅助解释
                          <textarea
                            aria-label="辅助解释"
                            required
                            value={explanation}
                            onChange={(event) =>
                              setExplanation(event.target.value)
                            }
                          />
                        </label>
                        <label className="form-field">
                          解释来源或参考
                          <input
                            aria-label="解释来源或参考"
                            value={explanationReference}
                            onChange={(event) =>
                              setExplanationReference(event.target.value)
                            }
                          />
                        </label>
                        <button
                          className="button"
                          disabled={props.busy || !explanation.trim()}
                        >
                          保存草稿解释
                        </button>
                      </form>
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void props.run(async () => {
                            await props.request<Entity>(
                              "/api/reading/vocabulary",
                              {
                                ...meta,
                                operationId: vocabularyOperation,
                                materialId,
                                sessionId,
                                term,
                                meaning,
                                context,
                                ...(due ? { due } : {}),
                                goalIds,
                              },
                            );
                            setVocabularyOperation(crypto.randomUUID());
                            setTerm("");
                            setMeaning("");
                            setContext("");
                            setDue("");
                            await props.onImported();
                            await load();
                          }, "词汇已保存为语言复习项，不新增阅读时长。");
                        }}
                      >
                        <h3>留下词汇复习项</h3>
                        <p className="form-help">
                          词汇关联一条实际阅读记录，便于回看上下文。
                        </p>
                        <label className="form-field">
                          词汇或短语
                          <input
                            aria-label="词汇或短语"
                            required
                            value={term}
                            onChange={(event) => setTerm(event.target.value)}
                          />
                        </label>
                        <label className="form-field">
                          词义或理解
                          <input
                            aria-label="词义或理解"
                            required
                            value={meaning}
                            onChange={(event) => setMeaning(event.target.value)}
                          />
                        </label>
                        <label className="form-field">
                          词汇原文上下文
                          <textarea
                            aria-label="词汇原文上下文"
                            required
                            value={context}
                            onChange={(event) => setContext(event.target.value)}
                          />
                        </label>
                        <label className="form-field">
                          词汇复习日期（可选）
                          <input
                            aria-label="词汇复习日期（可选）"
                            type="date"
                            value={due}
                            onChange={(event) => setDue(event.target.value)}
                          />
                        </label>
                        <button
                          className="button"
                          disabled={props.busy || !sessionId || !term.trim()}
                        >
                          保存词汇复习项
                        </button>
                      </form>
                    </div>
                    <div className="reading-artifacts">
                      {report?.explanations
                        .filter((item) => item.materialId === materialId)
                        .map(({ entity }) => (
                          <article className="reading-artifact" key={entity.id}>
                            <span className="kind-badge inference">
                              草稿推断
                            </span>
                            <ReadingSourceLink id={entity.id} {...props} />
                            <p>{entity.body}</p>
                          </article>
                        ))}
                      {report?.vocabulary
                        .filter((item) => item.materialId === materialId)
                        .map(({ entity }) => (
                          <article className="reading-artifact" key={entity.id}>
                            <span className="small-chip">
                              词汇复习 · 不计时
                            </span>
                            <ReadingSourceLink id={entity.id} {...props} />
                            <p>{entity.fields.meaning}</p>
                          </article>
                        ))}
                    </div>
                  </details>
                )}
              </>
            )}
          </details>
          <details className="reading-review" open>
            <summary>阅读进度回顾</summary>
            <button
              className="text-button"
              disabled={loading}
              onClick={() => void load()}
            >
              刷新阅读回顾
            </button>
            {report && (
              <>
                <div className="report-metrics">
                  <div>
                    <span>实际阅读总时长（只计一次）</span>
                    <strong>
                      {report.uniqueTotalMinutes}
                      <small>分钟</small>
                    </strong>
                  </div>
                  <div>
                    <span>材料与积累</span>
                    <strong>
                      {report.materials.length}
                      <small>
                        份材料 · {report.explanations.length} 条解释 ·{" "}
                        {report.vocabulary.length} 个词汇项
                      </small>
                    </strong>
                  </div>
                </div>
                <p className="form-help">
                  {report.countingPolicy}{" "}
                  各目标、领域和语言视角可能覆盖同一事实，不能相加。
                </p>
                <div className="reading-views">
                  {report.byLanguage.map((view) => (
                    <div className="reading-view" key={view.language}>
                      <strong>{view.language}阅读</strong>
                      <span>{view.minutes} 分钟</span>
                    </div>
                  ))}
                  {report.byDomain.map((view) => (
                    <div className="reading-view" key={view.domain}>
                      <strong>
                        {props.modules.find(
                          (module) => module.id === view.domain,
                        )?.name ?? view.domain}
                        视角
                      </strong>
                      <span>{view.minutes} 分钟</span>
                    </div>
                  ))}
                  {report.byGoal.map((view) => (
                    <div className="reading-view" key={view.goalId}>
                      <ReadingSourceLink id={view.goalId} {...props} />
                      <span>{view.minutes} 分钟</span>
                      <small>
                        {props.modules.find(
                          (module) => module.id === view.module,
                        )?.name ?? view.module}
                      </small>
                    </div>
                  ))}
                </div>
                {report.issues.map((issue, index) => (
                  <p className="report-warning" key={index}>
                    <ReadingSourceLink id={issue.entityId} {...props} /> ·{" "}
                    {issue.message}
                  </p>
                ))}
              </>
            )}
          </details>
        </>
      )}
    </section>
  );
}
