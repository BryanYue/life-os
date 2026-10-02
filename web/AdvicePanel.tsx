import { LocalDateTimeField } from "./LocalDateTimeField.js";
import React, { useEffect, useState } from "react";
import type { Entity } from "../src/types.js";
import type { AdviceReport, AdviceSuggestion } from "../src/advice.js";
import {
  BuiltinUpgradePrompt,
  GoalPicker,
  ReadingSourceLink,
  type ReadingUiProps,
} from "./ReadingWorkspace.js";
function AdviceCard({
  suggestion,
  asOf,
  days,
  onAdopted,
  onHide,
  ...props
}: ReadingUiProps & {
  suggestion: AdviceSuggestion;
  asOf: string;
  days: number;
  onAdopted: (id: string) => Promise<void>;
  onHide: () => void;
}) {
  const [title, setTitle] = useState(suggestion.proposedTask.title);
  const [body, setBody] = useState(suggestion.proposedTask.body ?? "");
  const [due, setDue] = useState("");
  const [timeZone, setTimeZone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [operationId] = useState(crypto.randomUUID());
  return (
    <article className="advice-card" data-advice-id={suggestion.id}>
      <div className="section-heading">
        <h3>{suggestion.title}</h3>
        <span className="kind-badge inference">待确认建议</span>
      </div>
      <p className="advice-explanation">{suggestion.explanation}</p>
      <div className="reading-linked-sources">
        <span>依据：</span>
        {[...new Set([...suggestion.goalIds, ...suggestion.evidenceIds])].map(
          (id) => (
            <ReadingSourceLink key={id} id={id} {...props} />
          ),
        )}
      </div>
      <p className="form-help">
        规则 {suggestion.ruleId} · {suggestion.ruleVersion} · 来源{" "}
        {suggestion.source.namespace}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void props.run(async () => {
            const entity = await props.request<Entity>("/api/advice/adopt", {
              adviceId: suggestion.id,
              asOf,
              days,
              operationId,
              task: {
                title,
                body,
                timeZone,
                focus: "阅读",
                ...(due ? { due } : {}),
              },
            });
            await props.onImported();
            await onAdopted(entity.id);
          }, "建议已采纳为学习待办；可在清单中继续推进。");
        }}
      >
        <details>
          <summary>采纳前调整待办（可选）</summary>
          <label className="form-field">
            建议待办标题
            <input
              aria-label="建议待办标题"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="form-field">
            建议待办说明
            <textarea
              aria-label="建议待办说明"
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <div className="form-grid">
            <LocalDateTimeField
              label="建议待办时间（可选）"
              value={due}
              onChange={setDue}
              timeZone={timeZone}
            />
            <label className="form-field">
              建议待办时区
              <input
                aria-label="建议待办时区"
                value={timeZone}
                onChange={(event) => setTimeZone(event.target.value)}
              />
            </label>
          </div>
        </details>
        <div className="settings-actions">
          <button
            className="button primary"
            disabled={props.busy || !title.trim()}
          >
            采纳为学习待办
          </button>
          <button
            type="button"
            className="button"
            disabled={props.busy}
            onClick={onHide}
          >
            本次隐藏
          </button>
        </div>
      </form>
    </article>
  );
}
export function AdvicePanel(props: ReadingUiProps) {
  const ready =
    (props.modules.find((module) => module.id === "learning")?.schemaVersion ??
      0) >= 2;
  const [asOf, setAsOf] = useState(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  });
  const [report, setReport] = useState<AdviceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hidden, setHidden] = useState(new Set<string>());
  const [selectedGoals, setSelectedGoals] = useState<string[]>([]);
  const [adopted, setAdopted] = useState<string[]>([]);
  async function load() {
    setLoading(true);
    setError("");
    try {
      setReport(
        await props.request<AdviceReport>(
          `/api/advice?asOf=${encodeURIComponent(asOf)}`,
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (ready) void load();
  }, [props.entities, ready]);
  const suggestions =
    report?.suggestions.filter(
      (suggestion) =>
        !hidden.has(suggestion.id) &&
        (!selectedGoals.length ||
          suggestion.goalIds.some((id) => selectedGoals.includes(id))),
    ) ?? [];
  return (
    <section
      className="panel specialist-panel advice-panel"
      aria-label="依据目标与事实的建议"
    >
      <div className="section-heading">
        <div>
          <h2>从记录中找到下一步</h2>
          <p>
            本地规则读取目标与事实，说明依据后给出可控建议。阅读先行；不会自动改计划、打卡或执行。
          </p>
        </div>
        <button
          className="button"
          disabled={loading}
          onClick={() => {
            setHidden(new Set());
            void load();
          }}
        >
          刷新本地建议
        </button>
      </div>
      {!ready ? (
        <BuiltinUpgradePrompt {...props} requiredModules={["learning"]} />
      ) : (
        <>
          {loading && (
            <p className="quiet-inline" role="status">
              正在根据本地目标与事实生成建议…
            </p>
          )}
          {error && (
            <div className="message error" role="alert">
              {error}
              <button className="text-button" onClick={() => void load()}>
                重试读取建议
              </button>
            </div>
          )}
          <details className="advice-filters">
            <summary>建议范围与参考日期</summary>
            <form
              className="report-controls"
              onSubmit={(event) => {
                event.preventDefault();
                setHidden(new Set());
                void load();
              }}
            >
              <label className="form-field">
                建议参考日期（UTC 日末）
                <input
                  aria-label="建议参考日期（UTC 日末）"
                  type="date"
                  required
                  value={asOf}
                  onChange={(event) => setAsOf(event.target.value)}
                />
              </label>
              <button className="button" disabled={loading}>
                按参考日期查看建议
              </button>
            </form>
            <GoalPicker
              {...props}
              selected={selectedGoals}
              onChange={setSelectedGoals}
              label="建议目标筛选"
            />
          </details>
          {!loading && !error && !suggestions.length && (
            <div className="advice-empty">
              <p>
                {hidden.size
                  ? "本次已隐藏或筛选了建议。刷新会重新评估并恢复显示。"
                  : "当前没有需要提示的新建议。可以建立目标、阅读材料或继续现有待办。"}
              </p>
              <button
                className="text-button"
                onClick={() => props.onCreateGoal?.("learning")}
              >
                建立自己的领域目标
              </button>
            </div>
          )}
          <div className="advice-grid">
            {suggestions.map((suggestion) => (
              <AdviceCard
                key={suggestion.id}
                suggestion={suggestion}
                asOf={report!.asOf}
                days={report!.days}
                {...props}
                onHide={() =>
                  setHidden((previous) => new Set([...previous, suggestion.id]))
                }
                onAdopted={async (id) => {
                  setAdopted((previous) => [...new Set([...previous, id])]);
                  await load();
                }}
              />
            ))}
          </div>
          {adopted.length > 0 && (
            <div className="advice-adopted">
              <p className="form-help">已采纳的待办：</p>
              {adopted.map((id) => (
                <ReadingSourceLink key={id} id={id} {...props} />
              ))}
            </div>
          )}
          <p className="form-help">
            “本次隐藏”只控制本次页面展示；刷新时重新评估。缺少事实不等于未完成。所有建议保留推断性质与来源。
          </p>
          {report?.issues.map((issue, index) => (
            <p className="report-warning" key={index}>
              {issue.entityId && (
                <ReadingSourceLink id={issue.entityId} {...props} />
              )}{" "}
              {issue.message}
            </p>
          ))}
        </>
      )}
    </section>
  );
}
