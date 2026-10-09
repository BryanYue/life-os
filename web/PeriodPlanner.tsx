import React, { useState } from "react";
import type {
  PeriodDay,
  PeriodGoal,
  PeriodPlanDraft,
  PeriodPlanInput,
  periodReview,
} from "../src/period-planner.js";
import type { SpecialistProps } from "./SpecialistPanels.js";
const timeMinute = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};
const clock = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const bufferLabels = {
  meals: "用餐预留",
  commute: "通勤预留",
  preparation: "准备预留",
  recovery: "恢复预留",
  sleep: "睡眠预留",
};
type Props = Pick<
  SpecialistProps,
  "request" | "run" | "busy" | "onImported" | "entities"
>;
export function PeriodPlanner(props: Props) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [timeZone, setTimeZone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [windows, setWindows] = useState([{ start: "", end: "" }]);
  const [goals, setGoals] = useState<
    (Omit<PeriodGoal, "minutes"> & { minutes: string; linkedId?: string })[]
  >([{ id: crypto.randomUUID(), title: "", minutes: "" }]);
  const existingGoals = props.entities.filter(
    (entity) =>
      !entity.deleted &&
      entity.kind === "plan" &&
      entity.status === "active" &&
      (entity.type === "goal" ||
        (entity.module === "planning" && entity.type === "direction") ||
        (entity.module === "languages" && entity.type === "language-goal")),
  );
  const [buffers, setBuffers] = useState<PeriodDay["buffers"]>({
    meals: 0,
    commute: 0,
    preparation: 0,
    recovery: 0,
    sleep: 0,
  });
  const [dayOverrides, setDayOverrides] = useState<
    Record<string, { scenario: PeriodDay["scenario"]; capacityFactor: string }>
  >({});
  const [advanced, setAdvanced] = useState(false);
  const [json, setJson] = useState("");
  const [draft, setDraft] = useState<PeriodPlanDraft | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [localError, setLocalError] = useState("");
  const dates: string[] = [];
  if (from && to && from <= to)
    for (
      let date = from;
      date <= to && dates.length < 367;
      date = new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10)
    )
      dates.push(date);
  function changed() {
    setDraft(null);
    setAccepted(false);
    setLocalError("");
  }
  function normalInput(): PeriodPlanInput {
    if (!dates.length || dates.length > 366)
      throw Error("请选择连续的周期日期，最多366天。");
    if (
      windows.some(
        (window) =>
          !window.start ||
          !window.end ||
          timeMinute(window.start) >= timeMinute(window.end),
      )
    )
      throw Error("请填写可安排窗口，结束时间需晚于开始。");
    if (
      goals.some(
        (goal) =>
          !goal.title.trim() || !goal.minutes || Number(goal.minutes) <= 0,
      )
    )
      throw Error("请填写目标和整个周期需要的总分钟数。");
    if (
      goals.some(
        (goal) =>
          goal.linkedId &&
          !existingGoals.some((entity) => entity.id === goal.linkedId),
      )
    )
      throw Error("选中的目标已不再活动，请重新选择目标。");
    const intervals = windows
      .map((window) => ({
        start: timeMinute(window.start),
        end: timeMinute(window.end),
      }))
      .sort((a, b) => a.start - b.start);
    return {
      timeZone,
      days: dates.map((date) => {
        const override = dayOverrides[date];
        return {
          date,
          startMinute: intervals[0].start,
          endMinute: intervals.at(-1)!.end,
          windows: intervals,
          protected: [],
          buffers,
          scenario: override?.scenario ?? "normal",
          ...(override?.capacityFactor
            ? { capacityFactor: Number(override.capacityFactor) }
            : {}),
        };
      }),
      goals: goals.map(({ linkedId, ...goal }) => ({
        ...goal,
        id: linkedId ?? goal.id,
        title: goal.title.trim(),
        minutes: Number(goal.minutes),
      })),
    };
  }
  return (
    <section
      className="panel specialist-panel period-planner"
      aria-label="高级周期规划"
    >
      <div className="section-heading">
        <div>
          <h2>多日与跨周规划</h2>
          <p>
            目标分钟数是整个周期的总需求。系统轮换目标，按每天的可安排窗口与容量分配。
          </p>
        </div>
        <span className="small-chip">用户填写</span>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setLocalError("");
          void props.run(async () => {
            const input: PeriodPlanInput = advanced
              ? (JSON.parse(json) as PeriodPlanInput)
              : normalInput();
            setDraft(
              await props.request<PeriodPlanDraft>("/api/plan/period", input),
            );
            setAccepted(false);
          });
        }}
      >
        <label className="check-field">
          <input
            type="checkbox"
            checked={advanced}
            onChange={(event) => {
              setAdvanced(event.target.checked);
              changed();
            }}
          />
          使用高级约束 JSON
        </label>
        {!advanced ? (
          <>
            <div className="form-grid">
              <label className="form-field">
                周期开始日期
                <input
                  type="date"
                  required
                  value={from}
                  onChange={(event) => {
                    setFrom(event.target.value);
                    changed();
                  }}
                />
              </label>
              <label className="form-field">
                周期结束日期
                <input
                  type="date"
                  required
                  value={to}
                  onChange={(event) => {
                    setTo(event.target.value);
                    changed();
                  }}
                />
              </label>
              <label className="form-field full">
                周期时区
                <input
                  value={timeZone}
                  required
                  onChange={(event) => {
                    setTimeZone(event.target.value);
                    changed();
                  }}
                />
              </label>
            </div>
            <h3 className="report-heading">每天可安排的窗口</h3>
            <p className="form-help">
              请填写实际空闲时间；多个窗口适用于午间与晚间等分段安排。可在高级约束中逐日调整。
            </p>
            {windows.map((window, index) => (
              <div className="period-window" key={index}>
                <label className="form-field">
                  窗口 {index + 1} 开始
                  <input
                    type="time"
                    required
                    value={window.start}
                    onChange={(event) => {
                      setWindows(
                        windows.map((item, i) =>
                          i === index
                            ? { ...item, start: event.target.value }
                            : item,
                        ),
                      );
                      changed();
                    }}
                  />
                </label>
                <label className="form-field">
                  窗口 {index + 1} 结束
                  <input
                    type="time"
                    required
                    value={window.end}
                    onChange={(event) => {
                      setWindows(
                        windows.map((item, i) =>
                          i === index
                            ? { ...item, end: event.target.value }
                            : item,
                        ),
                      );
                      changed();
                    }}
                  />
                </label>
                {windows.length > 1 && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setWindows(windows.filter((_, i) => i !== index));
                      changed();
                    }}
                  >
                    移除窗口
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setWindows([...windows, { start: "", end: "" }]);
                changed();
              }}
            >
              ＋ 添加可安排窗口
            </button>
            <h3 className="report-heading">周期目标</h3>
            <p className="form-help">
              选择已有活动目标后，采纳的行动将推进该目标；临时文本目标仅保存行动，不关联已有目标。
            </p>
            {goals.map((goal, index) => (
              <div className="period-goal" key={goal.id}>
                <label className="form-field">
                  关联已有目标 {index + 1}
                  <select
                    aria-label={`关联已有目标 ${index + 1}`}
                    value={goal.linkedId ?? ""}
                    onChange={(event) => {
                      const entity = existingGoals.find(
                        (item) => item.id === event.target.value,
                      );
                      setGoals(
                        goals.map((item, i) =>
                          i === index
                            ? {
                                ...item,
                                linkedId: entity?.id,
                                title: entity?.title ?? item.title,
                              }
                            : item,
                        ),
                      );
                      changed();
                    }}
                  >
                    <option value="">临时文本目标（不关联已有目标）</option>
                    {existingGoals.map((entity) => (
                      <option
                        key={entity.id}
                        value={entity.id}
                        disabled={goals.some(
                          (item, i) =>
                            i !== index && item.linkedId === entity.id,
                        )}
                      >
                        {entity.title} · {entity.module}/{entity.type}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  周期目标 {index + 1}
                  <input
                    required
                    value={goal.title}
                    onChange={(event) => {
                      setGoals(
                        goals.map((item, i) =>
                          i === index
                            ? { ...item, title: event.target.value }
                            : item,
                        ),
                      );
                      changed();
                    }}
                  />
                </label>
                <label className="form-field">
                  周期总分钟 {index + 1}
                  <input
                    type="number"
                    min="1"
                    required
                    value={goal.minutes}
                    onChange={(event) => {
                      setGoals(
                        goals.map((item, i) =>
                          i === index
                            ? { ...item, minutes: event.target.value }
                            : item,
                        ),
                      );
                      changed();
                    }}
                  />
                </label>
                {goals.length > 1 && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setGoals(goals.filter((_, i) => i !== index));
                      changed();
                    }}
                  >
                    移除目标
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setGoals([
                  ...goals,
                  { id: crypto.randomUUID(), title: "", minutes: "" },
                ]);
                changed();
              }}
            >
              ＋ 添加周期目标
            </button>
            <h3 className="report-heading">每天需要保护的时间</h3>
            <p className="form-help">
              仅填写窗口内需要扣除的分钟；窗口外的睡眠等时间已不可安排。
            </p>
            <div className="buffer-grid">
              {Object.entries(bufferLabels).map(([key, label]) => (
                <label key={key} className="form-field">
                  {label}
                  <input
                    type="number"
                    min="0"
                    max="1440"
                    value={buffers[key as keyof typeof buffers]}
                    onChange={(event) => {
                      setBuffers({
                        ...buffers,
                        [key]: Number(event.target.value),
                      });
                      changed();
                    }}
                  />
                </label>
              ))}
            </div>
            {dates.length > 0 && dates.length <= 366 && (
              <details className="day-capacity">
                <summary>逐日容量与加班 / 疲劳（{dates.length} 天）</summary>
                <p className="form-help">
                  正常1、加班0.6、疲劳0.3；自定义0至1覆盖场景系数，0表示当天不安排目标。
                </p>
                <div className="report-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>日期</th>
                        <th>场景</th>
                        <th>自定义 capacityFactor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dates.map((date) => (
                        <tr key={date}>
                          <td>{date}</td>
                          <td>
                            <label className="form-field">
                              <span className="sr-only">{date} 场景</span>
                              <select
                                value={dayOverrides[date]?.scenario ?? "normal"}
                                onChange={(event) => {
                                  setDayOverrides({
                                    ...dayOverrides,
                                    [date]: {
                                      capacityFactor:
                                        dayOverrides[date]?.capacityFactor ??
                                        "",
                                      scenario: event.target
                                        .value as PeriodDay["scenario"],
                                    },
                                  });
                                  changed();
                                }}
                              >
                                <option value="normal">正常</option>
                                <option value="overtime">加班</option>
                                <option value="fatigue">疲劳</option>
                              </select>
                            </label>
                          </td>
                          <td>
                            <label className="form-field">
                              <span className="sr-only">{date} 容量系数</span>
                              <input
                                type="number"
                                min="0"
                                max="1"
                                step="0.05"
                                placeholder="按场景"
                                value={dayOverrides[date]?.capacityFactor ?? ""}
                                onChange={(event) => {
                                  setDayOverrides({
                                    ...dayOverrides,
                                    [date]: {
                                      scenario:
                                        dayOverrides[date]?.scenario ??
                                        "normal",
                                      capacityFactor: event.target.value,
                                    },
                                  });
                                  changed();
                                }}
                              />
                            </label>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
            <button
              type="button"
              className="text-button advanced-entry"
              onClick={() => {
                try {
                  setJson(JSON.stringify(normalInput(), null, 2));
                  setAdvanced(true);
                  changed();
                } catch (error) {
                  setLocalError(
                    error instanceof Error ? error.message : String(error),
                  );
                }
              }}
            >
              将当前输入转为高级约束
            </button>
          </>
        ) : (
          <>
            <p className="form-help">
              完整输入含 timeZone、days 和
              goals。days需连续升序，每天含date/scenario/startMinute/endMinute/protected/buffers；windows为分钟区间，capacityFactor为0至1。protected可含location和kind（fixed/sleep）；startLocation与travel数组填写明确的from/to/minutes，不推测交通时间。goals可设location/sessionMinutes/minSessionMinutes。DST重复时间须用offsets明确偏移，如{" "}
              {`{"01:30":"-04:00"}`}；不存在的时间会报错，跨切换窗口应拆开。
            </p>
            <label className="form-field">
              高级周期约束 JSON
              <textarea
                className="period-json"
                required
                value={json}
                onChange={(event) => {
                  setJson(event.target.value);
                  changed();
                }}
                placeholder="粘贴完整 PeriodPlanInput，或先将普通表单转为高级约束"
              />
            </label>
          </>
        )}
        {localError && (
          <p className="message error" role="alert">
            {localError}
          </p>
        )}
        <button className="button primary planner-submit" disabled={props.busy}>
          生成周期规划建议
        </button>
      </form>
      {draft && (
        <div className="period-result">
          <h3 className="report-heading">周期建议 · {draft.input.timeZone}</h3>
          <p className="form-help">
            本地规则 {draft.ruleVersion} · {draft.slots.length}{" "}
            个时段，需确认后保存为计划。
          </p>
          <div className="report-scroll">
            <table>
              <thead>
                <tr>
                  <th>日期</th>
                  <th>容量系数</th>
                  <th>可用分钟</th>
                  <th>已安排分钟</th>
                </tr>
              </thead>
              <tbody>
                {draft.days.map((day) => (
                  <tr key={day.date}>
                    <td>{day.date}</td>
                    <td>{day.capacityFactor}</td>
                    <td>{day.budgetMinutes}</td>
                    <td>{day.scheduledMinutes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {draft.slots.map((slot, index) => (
            <article className="plan-slot" key={index}>
              <time>
                {slot.date}
                <span>
                  {clock(slot.start)}–{clock(slot.end)}
                </span>
              </time>
              <div>
                <h3>{slot.title}</h3>
                <p>
                  {(() => {
                    const entity = props.entities.find(
                      (item) => item.id === slot.goalId,
                    );
                    return entity
                      ? `推进目标：${entity.title} · ${entity.module}/${entity.type}`
                      : "临时文本目标 · 不关联已有目标";
                  })()}
                </p>
                <p>
                  {slot.location ? `${slot.location} · ` : ""}
                  {slot.startAt} → {slot.endAt}
                </p>
              </div>
            </article>
          ))}
          {draft.reservations.length > 0 && (
            <details>
              <summary>
                保护、缓冲与地点转移（{draft.reservations.length}）
              </summary>
              {draft.reservations.map((item, index) => (
                <p className="quiet-inline" key={index}>
                  {item.date} {clock(item.start)}–{clock(item.end)} ·{" "}
                  {item.label}
                  {item.location ? ` · ${item.location}` : ""}
                </p>
              ))}
            </details>
          )}
          {draft.unscheduled.length > 0 && (
            <div className="report-warning">
              <strong>未安排的需求</strong>
              {draft.unscheduled.map((item) => (
                <p key={item.id}>
                  {draft.input.goals.find((goal) => goal.id === item.id)
                    ?.title ?? item.id}{" "}
                  · {item.minutes} 分钟 · {item.reason}
                </p>
              ))}
            </div>
          )}
          {draft.issues.map((issue, index) => (
            <p className="report-warning" key={index}>
              {issue}
            </p>
          ))}
          <div className="accept-box">
            <p>确认后保存为生活规划记录；实际完成需另记事实并关联对应计划。</p>
            <button
              className="button primary"
              disabled={props.busy || accepted || !draft.slots.length}
              onClick={() =>
                void props.run(async () => {
                  await props.request("/api/plan/period/accept", { draft });
                  setAccepted(true);
                  await props.onImported();
                }, "周期规划已保存。")
              }
            >
              {accepted ? "✓ 周期规划已保存" : "确认并保存周期计划"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function ReviewPanel(props: SpecialistProps & { moduleId?: string }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [report, setReport] = useState<ReturnType<typeof periodReview> | null>(
    null,
  );
  return (
    <section className="panel specialist-panel" aria-label="周期复盘">
      <div className="section-heading">
        <div>
          <h2>周期计划与实际回看</h2>
          <p>对照本地计划和 actual-of 关联事实，生成下一周期的调整建议。</p>
        </div>
      </div>
      <form
        className="report-controls"
        onSubmit={(event) => {
          event.preventDefault();
          void props.run(async () => {
            const query = new URLSearchParams();
            if (from) query.set("from", from);
            if (to) query.set("to", to);
            if (props.moduleId) query.set("module", props.moduleId);
            setReport(
              await props.request<ReturnType<typeof periodReview>>(
                `/api/reports/review?${query}`,
              ),
            );
          });
        }}
      >
        <label className="form-field">
          复盘开始日期
          <input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setReport(null);
            }}
          />
        </label>
        <label className="form-field">
          复盘结束日期
          <input
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setReport(null);
            }}
          />
        </label>
        <button className="button" disabled={props.busy}>
          查看周期复盘
        </button>
      </form>
      {report && (
        <>
          <p className="form-help">规则 {report.ruleVersion} · 建议尚未采纳</p>
          {report.rows.length ? (
            <div className="report-scroll">
              <table>
                <thead>
                  <tr>
                    <th>计划</th>
                    <th>计划分钟</th>
                    <th>实际分钟</th>
                    <th>事实来源</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr key={row.planId}>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => props.onOpen(row.planId)}
                        >
                          {row.title}
                        </button>
                      </td>
                      <td>{row.plannedMinutes}</td>
                      <td>{row.actualMinutes}</td>
                      <td>
                        {row.evidenceIds.length
                          ? row.evidenceIds.map((id) => (
                              <button
                                className="text-button source-link"
                                key={id}
                                onClick={() => props.onOpen(id)}
                              >
                                {props.entities.find(
                                  (entity) => entity.id === id,
                                )?.title ?? id}
                              </button>
                            ))
                          : "尚无对应实际记录"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="quiet-inline">此范围暂无可对照的行动计划。</p>
          )}
          <p className="form-help">
            未关联行动计划的实际记录：{report.unmatchedActualCount} 条
          </p>
          {report.suggestions.map((suggestion, index) => (
            <p className="report-warning" key={index}>
              {suggestion.message}
            </p>
          ))}
          {report.issues.map((issue, index) => (
            <p className="form-help" key={index}>
              {issue}
            </p>
          ))}
        </>
      )}
    </section>
  );
}
