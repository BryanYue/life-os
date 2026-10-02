import { LocalDateTimeField } from "./LocalDateTimeField.js";
import React, { useEffect, useRef, useState } from "react";
import type { Entity } from "../src/types.js";
import type { LearningTasksReport } from "../src/learning-tasks.js";
import {
  BuiltinUpgradePrompt,
  GoalPicker,
  ReadingSourceLink,
  readableTime,
  type ReadingUiProps,
} from "./ReadingWorkspace.js";
function ReminderCard({
  reminder,
  status,
  busy,
  onAction,
  ...props
}: Pick<ReadingUiProps, "entities" | "onOpen" | "busy"> & {
  reminder: Entity;
  status: string;
  onAction: (
    reminder: Entity,
    action: "ack" | "snooze",
    value?: string,
  ) => Promise<void>;
}) {
  const [later, setLater] = useState("");
  return (
    <article className="reminder-card" data-reminder-id={reminder.id}>
      <div className="section-heading">
        <h4>{reminder.title}</h4>
        <span className="small-chip">{status}</span>
      </div>
      <p className="form-help">
        提醒时间{" "}
        {readableTime(String(reminder.fields.remindAt), reminder.timeZone)}
      </p>
      <ReadingSourceLink id={reminder.id} {...props} />
      {reminder.status === "active" && (
        <>
          <button
            className="button"
            disabled={busy}
            onClick={() => void onAction(reminder, "ack")}
          >
            确认此提醒
          </button>
          <details>
            <summary>延后此提醒</summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void onAction(reminder, "snooze", later);
              }}
            >
              <LocalDateTimeField
                label="新的提醒时间"
                value={later}
                onChange={setLater}
                timeZone={reminder.timeZone}
                required
              />
              <p className="form-help">
                需晚于当前提醒，偏移需与原时区 {reminder.timeZone}{" "}
                一致；夏令时重复时间须明确偏移。
              </p>
              <button className="button" disabled={busy || !later}>
                保存延后时间
              </button>
            </form>
          </details>
        </>
      )}
    </article>
  );
}
export function LearningTasks(props: ReadingUiProps) {
  const ready =
    (props.modules.find((module) => module.id === "learning")?.schemaVersion ??
      0) >= 2;
  const [report, setReport] = useState<LearningTasksReport | null>(null);
  const [asOf, setAsOf] = useState(new Date().toISOString());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [focus, setFocus] = useState("阅读");
  const [body, setBody] = useState("");
  const [goalIds, setGoalIds] = useState<string[]>([]);
  const [materialId, setMaterialId] = useState("");
  const [timeZone, setTimeZone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [taskOperation, setTaskOperation] = useState(crypto.randomUUID());
  const [reminderTitle, setReminderTitle] = useState("");
  const [remindAt, setRemindAt] = useState("");
  const [reminderTask, setReminderTask] = useState("");
  const [reminderOperation, setReminderOperation] = useState(
    crypto.randomUUID(),
  );
  const [pendingChecks, setPendingChecks] = useState<Record<string, boolean>>(
    {},
  );
  const operations = useRef(new Map<string, string>());
  const materials = props.entities.filter(
    (entity) =>
      !entity.deleted &&
      entity.module === "learning" &&
      entity.type === "material" &&
      entity.kind === "fact",
  );
  function operation(key: string) {
    let value = operations.current.get(key);
    if (!value) {
      value = crypto.randomUUID();
      operations.current.set(key, value);
    }
    return value;
  }
  async function load(at = asOf) {
    setLoading(true);
    setError("");
    try {
      setReport(
        await props.request<LearningTasksReport>(
          `/api/reports/learning-tasks?asOf=${encodeURIComponent(at)}`,
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
  async function check(id: string, outcome: "完成" | "撤销") {
    const entity = props.entities.find((item) => item.id === id);
    if (!entity) return;
    setPendingChecks((previous) => ({ ...previous, [id]: outcome === "完成" }));
    try {
      await props.run(
        async () => {
          await props.request("/api/learning/check-ins", {
            taskId: id,
            expectedVersion: entity.version,
            operationId: operation(`check:${id}:${entity.version}:${outcome}`),
            outcome,
          });
          await props.onImported();
          await load();
        },
        outcome === "完成"
          ? "已打卡；实际阅读时长仍需独立记录。"
          : "已撤销打卡，并保留变更事实。",
      );
    } finally {
      setPendingChecks((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
    }
  }
  async function reminderAction(
    reminder: Entity,
    action: "ack" | "snooze",
    value?: string,
  ) {
    await props.run(
      async () => {
        await props.request(
          `/api/learning/reminders/${encodeURIComponent(reminder.id)}/action`,
          {
            expectedVersion: reminder.version,
            operationId: operation(
              `reminder:${reminder.id}:${reminder.version}:${action}:${value ?? ""}`,
            ),
            action,
            ...(action === "snooze" ? { remindAt: value } : {}),
          },
        );
        await props.onImported();
        await load();
      },
      action === "ack" ? "提醒已确认。" : "提醒时间已延后。",
    );
  }
  return (
    <section
      className="panel specialist-panel learning-tasks"
      aria-label="学习清单与应用内提醒"
    >
      <div className="section-heading">
        <div>
          <h2>清单、提醒与进度回顾</h2>
          <p>
            先从阅读待办开始，按自己的长期目标推进。打卡不会自动填写阅读分钟。
          </p>
        </div>
      </div>
      {!ready ? (
        <BuiltinUpgradePrompt {...props} requiredModules={["learning"]} />
      ) : (
        <>
          <details className="learning-checklist" open>
            <summary>
              我的学习清单{" "}
              <span className="subtle">
                {report?.counts.pending ?? 0} 项待办
              </span>
            </summary>
            {loading && (
              <p className="quiet-inline" role="status">
                正在读取清单与提醒…
              </p>
            )}
            {error && (
              <div className="message error" role="alert">
                {error}
                <button className="text-button" onClick={() => void load()}>
                  重试读取清单
                </button>
              </div>
            )}
            <div className="checklist-items">
              {!report?.tasks.length && (
                <p className="quiet-inline">
                  还没有学习待办。可以手动创建，或查看依据已有目标生成的可控建议。
                </p>
              )}
              {report?.tasks.map((task) => (
                <article
                  className={`checklist-item ${task.status === "done" ? "completed" : ""}`}
                  key={task.id}
                  data-task-id={task.id}
                >
                  <label className="checklist-check">
                    <input
                      type="checkbox"
                      checked={pendingChecks[task.id] ?? task.status === "done"}
                      disabled={
                        props.busy || loading || task.id in pendingChecks
                      }
                      aria-label={`打卡 ${task.title}`}
                      onChange={(event) =>
                        void check(
                          task.id,
                          event.target.checked ? "完成" : "撤销",
                        )
                      }
                    />
                    <span>{task.title}</span>
                  </label>
                  <div className="checklist-meta">
                    <span>
                      {task.status === "done"
                        ? "已完成 · 可取消勾选撤销"
                        : "待推进"}
                    </span>
                    {task.due && (
                      <span>
                        计划时间{" "}
                        {readableTime(
                          task.due,
                          props.entities.find((item) => item.id === task.id)
                            ?.timeZone ?? timeZone,
                        )}
                      </span>
                    )}
                    <ReadingSourceLink id={task.id} {...props} />
                  </div>
                  <div className="reading-linked-sources">
                    {task.goalIds.map((id) => (
                      <ReadingSourceLink key={id} id={id} {...props} />
                    ))}
                    {task.materialIds.map((id) => (
                      <ReadingSourceLink key={id} id={id} {...props} />
                    ))}
                  </div>
                </article>
              ))}
            </div>
            <details className="manual-import">
              <summary>添加学习待办</summary>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void props.run(async () => {
                    await props.request<Entity>("/api/learning/tasks", {
                      operationId: taskOperation,
                      title,
                      timeZone,
                      ...(due ? { due } : {}),
                      focus,
                      body,
                      goalIds,
                      ...(materialId ? { materialId } : {}),
                    });
                    setTaskOperation(crypto.randomUUID());
                    setTitle("");
                    setBody("");
                    setDue("");
                    await props.onImported();
                    await load();
                  }, "学习待办已创建，可打卡并关联提醒。");
                }}
              >
                <label className="form-field">
                  学习待办标题
                  <input
                    aria-label="学习待办标题"
                    required
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
                <div className="form-grid">
                  <label className="form-field">
                    学习方式
                    <select
                      aria-label="学习方式"
                      value={focus}
                      onChange={(event) => setFocus(event.target.value)}
                    >
                      <option>阅读</option>
                      <option>词汇复习</option>
                      <option>表达整理</option>
                      <option>口语（后续可选）</option>
                      <option>其他</option>
                    </select>
                  </label>
                  <LocalDateTimeField
                    label="待办计划时间（可选）"
                    value={due}
                    onChange={setDue}
                    timeZone={timeZone}
                  />
                  <label className="form-field">
                    任务与提醒时区
                    <input
                      aria-label="任务与提醒时区"
                      required
                      value={timeZone}
                      onChange={(event) => setTimeZone(event.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    关联学习材料（可选）
                    <select
                      aria-label="关联学习材料（可选）"
                      value={materialId}
                      onChange={(event) => setMaterialId(event.target.value)}
                    >
                      <option value="">不关联材料</option>
                      {materials.map((entity) => (
                        <option key={entity.id} value={entity.id}>
                          {entity.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field full">
                    待办说明
                    <textarea
                      aria-label="待办说明"
                      value={body}
                      onChange={(event) => setBody(event.target.value)}
                    />
                  </label>
                </div>
                <GoalPicker
                  {...props}
                  selected={goalIds}
                  onChange={setGoalIds}
                  label="待办支持的目标"
                />
                <button
                  className="button primary"
                  disabled={props.busy || !title.trim()}
                >
                  创建学习待办
                </button>
              </form>
            </details>
          </details>
          <details className="learning-reminders" open>
            <summary>
              应用内提醒{" "}
              <span className="subtle">
                {report?.reminders.due.length ?? 0} 项到期 ·{" "}
                {report?.reminders.upcoming.length ?? 0} 项后续
              </span>
            </summary>
            <p className="in-app-note">
              仅在打开本页面或手动刷新时计算提醒。不会请求系统通知权限、创建定时任务或向外部推送。
            </p>
            <div className="settings-actions">
              <button
                className="button"
                disabled={loading}
                onClick={() => {
                  const current = new Date().toISOString();
                  setAsOf(current);
                  void load(current);
                }}
              >
                按当前时间刷新提醒
              </button>
            </div>
            <div className="reminder-grid">
              {report?.reminders.due.map((reminder) => (
                <ReminderCard
                  key={reminder.id}
                  reminder={reminder}
                  status="已到提醒时间"
                  {...props}
                  onAction={reminderAction}
                />
              ))}
              {report?.reminders.upcoming.map((reminder) => (
                <ReminderCard
                  key={reminder.id}
                  reminder={reminder}
                  status="后续提醒"
                  {...props}
                  onAction={reminderAction}
                />
              ))}
            </div>
            {report &&
              !report.reminders.due.length &&
              !report.reminders.upcoming.length && (
                <p className="quiet-inline">当前没有待处理提醒。</p>
              )}
            <details className="manual-import">
              <summary>添加应用内提醒</summary>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void props.run(async () => {
                    await props.request<Entity>("/api/learning/reminders", {
                      operationId: reminderOperation,
                      title: reminderTitle,
                      remindAt,
                      timeZone,
                      ...(reminderTask ? { taskId: reminderTask } : {}),
                    });
                    setReminderOperation(crypto.randomUUID());
                    setReminderTitle("");
                    setRemindAt("");
                    await props.onImported();
                    await load();
                  }, "应用内提醒已保存，打开或刷新页面时可见。");
                }}
              >
                <label className="form-field">
                  提醒标题
                  <input
                    aria-label="提醒标题"
                    required
                    value={reminderTitle}
                    onChange={(event) => setReminderTitle(event.target.value)}
                  />
                </label>
                <div className="form-grid">
                  <LocalDateTimeField
                    label="提醒时间"
                    value={remindAt}
                    onChange={setRemindAt}
                    timeZone={timeZone}
                    required
                  />
                  <label className="form-field">
                    提醒关联的待办
                    <select
                      aria-label="提醒关联的待办"
                      value={reminderTask}
                      onChange={(event) => setReminderTask(event.target.value)}
                    >
                      <option value="">不关联待办</option>
                      {report?.tasks.map((task) => (
                        <option key={task.id} value={task.id}>
                          {task.title}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="form-help">
                  使用上方时区 {timeZone}
                  ；选择日期和时间即可，可在待办表单调整任务与提醒时区。
                </p>
                <button
                  className="button"
                  disabled={props.busy || !reminderTitle.trim() || !remindAt}
                >
                  保存应用内提醒
                </button>
              </form>
            </details>
            {(report?.reminders.acknowledged.length ?? 0) > 0 && (
              <details>
                <summary>
                  已确认提醒（{report?.reminders.acknowledged.length}）
                </summary>
                {report?.reminders.acknowledged.map((reminder) => (
                  <ReminderCard
                    key={reminder.id}
                    reminder={reminder}
                    status="已确认"
                    {...props}
                    onAction={reminderAction}
                  />
                ))}
              </details>
            )}
          </details>
          <details className="learning-progress" open>
            <summary>清单进度回顾</summary>
            <div className="report-metrics">
              <div>
                <span>待办总数</span>
                <strong>{report?.counts.total ?? 0}</strong>
              </div>
              <div>
                <span>当前完成 / 待推进</span>
                <strong>
                  {report?.counts.completed ?? 0} /{" "}
                  {report?.counts.pending ?? 0}
                </strong>
              </div>
              <div>
                <span>打卡与撤销事实</span>
                <strong>{report?.counts.checkIns ?? 0}</strong>
              </div>
            </div>
            <p className="form-help">
              目标视角可能覆盖同一待办，不能把各目标的完成数量相加。
            </p>
            <div className="reading-views">
              {report?.goalViews.map((view) => (
                <div className="reading-view" key={view.goalId}>
                  <ReadingSourceLink id={view.goalId} {...props} />
                  <span>
                    完成 {view.completed} · 待推进 {view.pending}
                  </span>
                </div>
              ))}
            </div>
            <details>
              <summary>最近打卡与撤销记录</summary>
              {report?.checkIns
                .slice(-8)
                .reverse()
                .map((entity) => (
                  <div className="reading-history-row" key={entity.id}>
                    <ReadingSourceLink id={entity.id} {...props} />
                    <span>{entity.fields.outcome}</span>
                    <small>{entity.occurredAt}</small>
                  </div>
                ))}
            </details>
            <details>
              <summary>按指定时间回顾（可选）</summary>
              <form
                className="report-controls"
                onSubmit={(event) => {
                  event.preventDefault();
                  void load();
                }}
              >
                <LocalDateTimeField
                  label="清单回顾时间"
                  value={asOf}
                  onChange={setAsOf}
                  timeZone={timeZone}
                  required
                />
                <button className="button" disabled={loading}>
                  按查看时间回顾
                </button>
              </form>
            </details>
            <p className="form-help">
              本次查看时间：{readableTime(report?.asOf ?? asOf, timeZone)}
            </p>
            {report?.issues.map((issue, index) => (
              <p className="report-warning" key={index}>
                <ReadingSourceLink id={issue.entityId} {...props} /> ·{" "}
                {issue.message}
              </p>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
