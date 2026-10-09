import React, { useEffect, useRef, useState } from "react";
import type { Entity } from "../src/types.js";
import type { LearningLoopReport, ItemInput } from "../src/learning-loop.js";
import type {
  AssessmentData,
  Candidate,
  TeacherContract,
} from "../src/learning-loop-contract.js";
import { hasLearningLoop } from "../src/learning-loop-contract.js";
import { LocalDateTimeField } from "./LocalDateTimeField.js";
import { normalizeLanguage, languageOptions } from "../src/languages.js";
import {
  GoalPicker,
  browserNow,
  type ReadingUiProps,
} from "./ReadingWorkspace.js";

const emptyItem = (): ItemInput => ({
  item: { source: "", id: "", version: "1" },
  skill: "读",
  tag: "",
  answer: "",
  outcome: "correct",
  goalIds: [],
});
const now = () => ({
  occurredAt: browserNow(),
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
});
const statusLabel = (status: string) =>
  status === "insufficient" ? "独立样本不足" : "仅描述样本";
function Field({
  label,
  value,
  onChange,
  type = "text",
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <label className="form-field">
      {label}
      <input
        aria-label={label}
        value={value}
        type={type}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function Text({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="form-field">
      {label}
      <textarea
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function LearningLoop(props: ReadingUiProps) {
  const { request, run, busy, entities } = props;
  const module = props.modules.find((m) => m.id === "languages");
  const [report, setReport] = useState<LearningLoopReport | null>(null);
  const [readError, setReadError] = useState("");
  const [language, setLanguage] = useState("en"),
    [goalIds, setGoalIds] = useState<string[]>([]);
  const [configGoal, setConfigGoal] = useState(""),
    [targetScore, setTargetScore] = useState(""),
    [targetReason, setTargetReason] = useState("");
  const [scaleId, setScaleId] = useState(""),
    [scaleMin, setScaleMin] = useState(""),
    [scaleMax, setScaleMax] = useState("");
  const [useCandidate, setUseCandidate] = useState(false),
    [candidateValues, setCandidateValues] = useState(["", "", "", ""]);
  const [sessionTitle, setSessionTitle] = useState(""),
    [sessionSkill, setSessionSkill] = useState("读"),
    [minutes, setMinutes] = useState(""),
    [context, setContext] = useState(""),
    [readingId, setReadingId] = useState("");
  const [sessionEdit, setSessionEdit] = useState<Entity | null>(null);
  const [assessmentTitle, setAssessmentTitle] = useState(""),
    [phase, setPhase] = useState("baseline"),
    [category, setCategory] = useState("practice"),
    [assessmentSession, setAssessmentSession] = useState("");
  const [evaluationSource, setEvaluationSource] = useState(""),
    [evaluationId, setEvaluationId] = useState(""),
    [evaluationVersion, setEvaluationVersion] = useState("1");
  const [formSource, setFormSource] = useState(""),
    [formId, setFormId] = useState(""),
    [formVersion, setFormVersion] = useState("1"),
    [difficulty, setDifficulty] = useState(""),
    [conditions, setConditions] = useState("");
  const [score, setScore] = useState(""),
    [scoreReference, setScoreReference] = useState(""),
    [practiceOnly, setPracticeOnly] = useState(false),
    [items, setItems] = useState<ItemInput[]>([emptyItem()]);
  const [assessmentEdit, setAssessmentEdit] = useState<Entity | null>(null);
  const [method, setMethod] = useState(""),
    [methodReason, setMethodReason] = useState(""),
    [methodEvidence, setMethodEvidence] = useState<string[]>([]);
  const [teacherSource, setTeacherSource] = useState(""),
    [teacherId, setTeacherId] = useState(""),
    [teacherRevision, setTeacherRevision] = useState("1"),
    [original, setOriginal] = useState(""),
    [teacherSummary, setTeacherSummary] = useState(""),
    [modality, setModality] = useState("text"),
    [recommendations, setRecommendations] = useState("");
  const [teacherJson, setTeacherJson] = useState(""),
    [reviewedTeacher, setReviewedTeacher] = useState(false),
    [teacherEdit, setTeacherEdit] = useState<Entity | null>(null),
    [teacherEditText, setTeacherEditText] = useState("");
  const [stamp, setStamp] = useState(now());
  const operationIds = useRef(new Map<string, string>());
  const languageChoices = languageOptions(
    props.languageCatalog,
    props.profile?.languagePreferences.activeCodes,
    [language],
  );
  const scale = () => ({
    id: scaleId,
    min: Number(scaleMin),
    max: Number(scaleMax),
  });
  const candidate = (): Candidate | undefined =>
    useCandidate
      ? {
          minutesMin: Number(candidateValues[0]),
          minutesMax: Number(candidateValues[1]),
          retestWeeksMin: Number(candidateValues[2]),
          retestWeeksMax: Number(candidateValues[3]),
        }
      : undefined;
  async function load() {
    try {
      setReport(await request<LearningLoopReport>("/api/learning-loop/report"));
      setReadError("");
    } catch (error) {
      setReadError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  useEffect(() => {
    if (module?.enabled && hasLearningLoop(module))
      void load().catch(() => {
        // Passive refresh errors are displayed by load; explicit actions must reject.
      });
  }, [entities, module?.schemaVersion, module?.enabled]);
  async function command(endpoint: string, data: Record<string, unknown>) {
    const key = endpoint + JSON.stringify(data);
    let operationId = operationIds.current.get(key);
    if (!operationId) {
      operationId = crypto.randomUUID();
      operationIds.current.set(key, operationId);
    }
    const result = await request<Entity>(endpoint, { ...data, operationId });
    await props.onImported();
    await load();
    operationIds.current.delete(key);
    return result;
  }
  const common = (title: string) => ({
    ...stamp,
    title,
    language,
    goalIds,
  });
  const editing = (entity: Entity | null) =>
    entity
      ? {
          entityId: entity.id,
          expectedVersion: entity.version,
          expectedNoteHash: entity.noteHash,
        }
      : {};
  const sessions =
    report?.sessions.filter(
      (row) => normalizeLanguage(row.entity.fields.language) === language,
    ) ?? [];
  const goals = entities.filter(
    (e) =>
      !e.deleted &&
      e.kind === "plan" &&
      e.status === "active" &&
      ["goal", "direction", "language-goal"].includes(e.type),
  );
  const readSessions = entities.filter(
    (e) =>
      !e.deleted &&
      e.module === "learning" &&
      e.type === "session" &&
      e.kind === "fact" &&
      e.status === "done" &&
      normalizeLanguage(e.fields.language) === language &&
      props.modules.some((m) => m.id === "learning" && m.enabled),
  );
  function editSession(e: Entity) {
    setStamp({ occurredAt: e.occurredAt, timeZone: e.timeZone });
    const row = report!.sessions.find((r) => r.entity.id === e.id)!;
    setSessionEdit(e);
    setSessionTitle(e.title);
    setLanguage(normalizeLanguage(e.fields.language)!);
    setSessionSkill(String(e.fields.skill));
    setMinutes(String(e.fields.minutes ?? ""));
    setContext(String(e.fields.context ?? ""));
    setReadingId(row.data?.readingSessionId ?? "");
    setGoalIds(
      e.relations.filter((r) => r.type === "supports").map((r) => r.target),
    );
  }
  function editAssessment(entity: Entity, data: AssessmentData) {
    setStamp({ occurredAt: entity.occurredAt, timeZone: entity.timeZone });
    setAssessmentEdit(entity);
    setAssessmentTitle(entity.title);
    setPhase(data.phase);
    setCategory(data.category);
    setAssessmentSession(data.sessionId ?? "");
    setEvaluationSource(data.evaluation.source);
    setEvaluationId(data.evaluation.id);
    setEvaluationVersion(data.evaluation.version);
    setScaleId(data.scale.id);
    setScaleMin(String(data.scale.min));
    setScaleMax(String(data.scale.max));
    setFormSource(data.form.source);
    setFormId(data.form.id);
    setFormVersion(data.form.version);
    setDifficulty(data.difficulty);
    setConditions(data.conditions);
    setScore(data.score === undefined ? "" : String(data.score));
    setScoreReference(data.scoreReference ?? "");
    setPracticeOnly(false);
    setItems(
      report!.attempts
        .filter((r) => r.data.assessmentId === entity.id)
        .map((r) => ({
          ...r.data,
          goalIds: r.entity.relations
            .filter((link) => link.type === "supports")
            .map((link) => link.target),
          entityId: r.entity.id,
          expectedVersion: r.entity.version,
          expectedNoteHash: r.entity.noteHash,
        }))
        .map(
          ({
            item,
            skill,
            tag,
            answer,
            outcome,
            errorType,
            goalIds,
            entityId,
            expectedVersion,
            expectedNoteHash,
          }) => ({
            item,
            skill,
            tag,
            answer,
            outcome,
            ...(errorType ? { errorType } : {}),
            goalIds,
            entityId,
            expectedVersion,
            expectedNoteHash,
          }),
        ),
    );
  }
  async function recycle(entity: Entity, deleted: boolean) {
    await request("/api/entities", {
      expectedVersion: entity.version,
      expectedNoteHash: entity.noteHash,
      entity: { ...entity, deleted },
    });
    await props.onImported();
    await load();
  }
  async function importTeacher(contract: TeacherContract) {
    const old = report?.teacherSummaries.find(
      (row) =>
        row.data.contract.source.namespace === contract.source.namespace &&
        row.data.contract.source.id === contract.source.id,
    );
    await request("/api/learning-loop/teacher-import", {
      contract,
      ...(old && reviewedTeacher
        ? {
            expectedVersion: old.entity.version,
            expectedNoteHash: old.entity.noteHash,
          }
        : {}),
    });
    await props.onImported();
    await load();
    setReviewedTeacher(false);
  }
  if (!module?.enabled)
    return (
      <section className="panel learning-loop">
        <h2>量化学习闭环</h2>
        <p>英语 / 日语模块已停用，历史保留。请在设置中明确启用后操作。</p>
      </section>
    );
  if (!hasLearningLoop(module))
    return (
      <section className="panel learning-loop">
        <h2>量化学习闭环</h2>
        <p>
          显式升级语言模块到 schema
          4，保留原有目标、练习、复习项及自定义字段。schema 2 分 2→3 与 3→4
          两阶段保存备份；第二步失败时停在 schema 3，可重试或从迁移备份恢复。
        </p>
        <button
          className="button primary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await request("/api/learning-loop/upgrade", {});
              await props.onImported();
            }, "语言量化学习模块已升级，个人目标完整保留。")
          }
        >
          升级量化学习模块
        </button>
      </section>
    );
  return (
    <section className="panel learning-loop" aria-label="量化学习闭环">
      <h2>量化学习闭环</h2>
      <p>
        基线 → 练习与错项 → 新题复测 →
        人工方法调整。记录与比较仅描述样本，不能证明学习效果；官方成绩、模拟与练习分开保存。
      </p>
      <div className="form-row">
        <label className="form-field">
          闭环语言
          <select
            aria-label="闭环语言"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            {languageChoices.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await props.onImported();
              await load();
            }, "已重新读取记录；保留当前表单，核对版本后再提交。")
          }
        >
          重新读取闭环记录
        </button>
      </div>
      {readError && (
        <p role="alert" className="message error">
          {readError}
        </p>
      )}
      <GoalPicker
        {...props}
        selected={goalIds}
        onChange={setGoalIds}
        label="本次闭环支持目标"
      />
      <div className="form-row">
        <Field
          label="闭环记录 IANA 时区"
          value={stamp.timeZone}
          onChange={(value) => setStamp((old) => ({ ...old, timeZone: value }))}
        />
        <LocalDateTimeField
          label="本次记录发生时间"
          value={stamp.occurredAt}
          timeZone={stamp.timeZone}
          onChange={(value) =>
            setStamp((old) => ({ ...old, occurredAt: value }))
          }
          required
        />
      </div>
      <p className="form-help">
        此时间用于新建会话、测评和教师手工导入；补录请填实际发生时间。更正可改变显示时间，但原来的最早作答证据仍保留。
      </p>
      <details open>
        <summary>分数目标与候选参数</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const previous = report?.configurations
                .filter(
                  (row) =>
                    row.data.goalId === configGoal &&
                    normalizeLanguage(row.entity.fields.language) === language,
                )
                .sort((a, b) => b.data.revision - a.data.revision)[0];
              await command("/api/learning-loop/configure", {
                ...common("学习配置 · " + configGoal),
                goalId: configGoal,
                scale: scale(),
                targetScore: Number(targetScore),
                reason: targetReason,
                ...(candidate() ? { candidate: candidate() } : {}),
                ...(previous ? { previousId: previous.entity.id } : {}),
              });
              setTargetReason("");
            }, "已追加目标配置，旧目标与旧配置保留。");
          }}
        >
          <label className="form-field">
            配置关联目标
            <select
              aria-label="配置关联目标"
              value={configGoal}
              onChange={(e) => setConfigGoal(e.target.value)}
            >
              <option value="">选择已有目标</option>
              {goals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.title}
                </option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <Field label="量尺 ID" value={scaleId} onChange={setScaleId} />
            <Field
              label="量尺最小分"
              type="number"
              value={scaleMin}
              onChange={setScaleMin}
            />
            <Field
              label="量尺最大分"
              type="number"
              value={scaleMax}
              onChange={setScaleMax}
            />
            <Field
              label="个人目标分数"
              type="number"
              value={targetScore}
              onChange={setTargetScore}
            />
          </div>
          <Field
            label="目标设定或变更理由"
            value={targetReason}
            onChange={setTargetReason}
          />
          <label className="check-field">
            <input
              type="checkbox"
              checked={useCandidate}
              onChange={(e) => setUseCandidate(e.target.checked)}
            />
            记录候选时长与复测周期
          </label>
          {useCandidate && (
            <div className="form-row">
              {[
                "候选分钟下限",
                "候选分钟上限",
                "候选复测周数下限",
                "候选复测周数上限",
              ].map((label, index) => (
                <Field
                  key={label}
                  label={label}
                  type="number"
                  value={candidateValues[index]}
                  onChange={(value) =>
                    setCandidateValues((old) =>
                      old.map((item, i) => (i === index ? value : item)),
                    )
                  }
                />
              ))}
            </div>
          )}
          <p className="form-help">
            650、700 或其他目标由你配置；20–30 分钟、1–4
            周仅可作为自行输入的候选，不构成承诺。
          </p>
          <button className="button" disabled={busy}>
            追加目标配置
          </button>
        </form>
        <ul>
          {report?.configurations
            .filter(
              (row) =>
                normalizeLanguage(row.entity.fields.language) === language,
            )
            .map((row) => (
              <li key={row.entity.id}>
                {row.current ? "当前" : "历史"} · {row.data.targetScore} /{" "}
                {row.data.scale.max} · 版本 {row.data.revision} ·{" "}
                {row.data.reason}
              </li>
            ))}
        </ul>
      </details>
      <details open>
        <summary>练习会话 · 唯一时长</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await command("/api/learning-loop/sessions", {
                ...common(sessionTitle),
                ...editing(sessionEdit),
                skill: sessionSkill,
                context,
                ...(readingId
                  ? { readingSessionId: readingId }
                  : { minutes: Number(minutes) }),
              });
              setSessionEdit(null);
              setSessionTitle("");
              setMinutes("");
              setContext("");
              setReadingId("");
              setStamp(now());
            }, "已保存练习会话，只计时一次。");
          }}
        >
          <Field
            label="练习会话标题"
            value={sessionTitle}
            onChange={setSessionTitle}
          />
          <label className="form-field">
            练习技能
            <select
              aria-label="练习技能"
              value={sessionSkill}
              onChange={(e) => setSessionSkill(e.target.value)}
            >
              {["听", "说", "读", "写"].map((skill) => (
                <option key={skill}>{skill}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            复用已有阅读会话
            <select
              aria-label="复用已有阅读会话"
              value={readingId}
              onChange={(e) => setReadingId(e.target.value)}
            >
              <option value="">独立练习，填写分钟</option>
              {readSessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.title} · {session.fields.minutes} 分钟
                </option>
              ))}
            </select>
          </label>
          {!readingId && (
            <Field
              label="独立练习分钟"
              type="number"
              value={minutes}
              onChange={setMinutes}
            />
          )}
          <Field label="练习情境与方法" value={context} onChange={setContext} />
          <button className="button" disabled={busy}>
            {sessionEdit ? "保存练习更正" : "保存练习会话"}
          </button>
          {sessionEdit && (
            <button
              type="button"
              className="button"
              onClick={() => setSessionEdit(null)}
            >
              取消练习更正
            </button>
          )}
        </form>
        <p className="learning-loop-total">
          阅读与语言练习合计（并集）：{report?.uniqueTotalMinutes ?? 0}{" "}
          分钟。题目、测评和摘要不另计时。
        </p>
        {sessions.map((row) => (
          <div className="loop-record" key={row.entity.id}>
            <strong>{row.entity.title}</strong>
            <span>
              {row.minutes} 分钟 ·{" "}
              {row.data?.readingSessionId ? "复用阅读" : "独立练习"}
            </span>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => editSession(row.entity)}
            >
              更正练习 · {row.entity.title}
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void run(
                  () => recycle(row.entity, true),
                  "已移入回收站，题目暴露历史保留。",
                )
              }
            >
              删除练习 · {row.entity.title}
            </button>
          </div>
        ))}
      </details>
      <details open>
        <summary>基线、后续测评与题目作答</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const form = {
                  source: formSource,
                  id: formId,
                  version: formVersion,
                },
                preparedItems = items.map((item) => ({
                  ...item,
                  item: { ...item.item, source: formSource },
                  goalIds: item.goalIds.length ? item.goalIds : goalIds,
                }));
              await command(
                practiceOnly
                  ? "/api/learning-loop/attempts"
                  : "/api/learning-loop/assessments",
                {
                  ...common(assessmentTitle),
                  ...editing(assessmentEdit),
                  sessionId: assessmentSession || undefined,
                  form,
                  items:
                    category === "official" && !practiceOnly
                      ? []
                      : preparedItems,
                  ...(!practiceOnly
                    ? {
                        phase,
                        category,
                        evaluation: {
                          source: evaluationSource,
                          id: evaluationId,
                          version: evaluationVersion,
                        },
                        scale: scale(),
                        difficulty,
                        conditions,
                        ...(score
                          ? { score: Number(score), scoreReference }
                          : {}),
                      }
                    : {}),
                },
              );
              setAssessmentEdit(null);
              setAssessmentTitle("");
              setItems([emptyItem()]);
              setStamp(now());
            }, "已保存结构化测评/作答；首次与重复由历史判定。");
          }}
        >
          <Field
            label="测评或题目记录标题"
            value={assessmentTitle}
            onChange={setAssessmentTitle}
          />
          <label className="check-field">
            <input
              aria-label="仅记录练习题"
              type="checkbox"
              checked={practiceOnly}
              disabled={!!assessmentEdit}
              onChange={(e) => setPracticeOnly(e.target.checked)}
            />
            仅记录练习题，独立于测评
          </label>
          <label className="form-field">
            关联练习会话
            <select
              aria-label="关联练习会话"
              value={assessmentSession}
              disabled={!!assessmentEdit}
              onChange={(e) => setAssessmentSession(e.target.value)}
            >
              <option value="">选择会话（官方成绩可不关联）</option>
              {sessions.map((row) => (
                <option key={row.entity.id} value={row.entity.id}>
                  {row.entity.title}
                </option>
              ))}
            </select>
          </label>
          {!practiceOnly && (
            <>
              <div className="form-row">
                <label className="form-field">
                  测评阶段
                  <select
                    aria-label="测评阶段"
                    value={phase}
                    onChange={(e) => setPhase(e.target.value)}
                  >
                    <option value="baseline">基线</option>
                    <option value="checkpoint">阶段测评</option>
                    <option value="retest">新题复测</option>
                  </select>
                </label>
                <label className="form-field">
                  成绩类别
                  <select
                    aria-label="成绩类别"
                    value={category}
                    disabled={!!assessmentEdit}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="practice">练习测评</option>
                    <option value="mock">模拟测评</option>
                    <option value="official">官方报告成绩</option>
                  </select>
                </label>
              </div>
              <div className="form-row">
                <Field
                  label="评测协议来源"
                  value={evaluationSource}
                  onChange={setEvaluationSource}
                />
                <Field
                  label="评测协议 ID"
                  value={evaluationId}
                  onChange={setEvaluationId}
                />
                <Field
                  label="评测协议版本"
                  value={evaluationVersion}
                  onChange={setEvaluationVersion}
                />
              </div>
              <Field
                label="测评难度"
                value={difficulty}
                onChange={setDifficulty}
              />
              <Field
                label="测试条件（限时/辅助/环境）"
                value={conditions}
                onChange={setConditions}
              />
              <div className="form-row">
                <Field
                  label="人工报告分数（可选）"
                  value={score}
                  type="number"
                  onChange={setScore}
                />
                <Field
                  label="分数来源或报告引用"
                  value={scoreReference}
                  onChange={setScoreReference}
                />
              </div>
              <p className="form-help">
                使用上方填写的量尺，保存原始人工报告分数。系统不提供换分或官方试题。
              </p>
            </>
          )}
          <div className="form-row">
            <Field
              label="题卷来源"
              value={formSource}
              disabled={!!assessmentEdit}
              onChange={setFormSource}
            />
            <Field
              label="题卷 ID"
              value={formId}
              disabled={!!assessmentEdit}
              onChange={setFormId}
            />
            <Field
              label="题卷版本"
              value={formVersion}
              disabled={!!assessmentEdit}
              onChange={setFormVersion}
            />
          </div>
          {(category !== "official" || practiceOnly) && (
            <>
              <p className="form-help">
                仅录入合成或已获准的题目证据；来源 + 题目 ID
                即见过身份，版本修订不会变成新题。
              </p>
              {items.map((item, index) => (
                <fieldset className="loop-item" key={index}>
                  <legend>题目 {index + 1}</legend>
                  <div className="form-row">
                    <Field
                      label={`题目 ${index + 1} ID`}
                      value={item.item.id}
                      disabled={!!item.entityId}
                      onChange={(value) =>
                        setItems((old) =>
                          old.map((row, i) =>
                            i === index
                              ? { ...row, item: { ...row.item, id: value } }
                              : row,
                          ),
                        )
                      }
                    />
                    <Field
                      label={`题目 ${index + 1} 版本`}
                      value={item.item.version}
                      disabled={!!item.entityId}
                      onChange={(value) =>
                        setItems((old) =>
                          old.map((row, i) =>
                            i === index
                              ? {
                                  ...row,
                                  item: { ...row.item, version: value },
                                }
                              : row,
                          ),
                        )
                      }
                    />
                  </div>
                  <label className="form-field">
                    题目 {index + 1} 技能
                    <select
                      aria-label={`题目 ${index + 1} 技能`}
                      value={item.skill}
                      onChange={(e) =>
                        setItems((old) =>
                          old.map((row, i) =>
                            i === index
                              ? {
                                  ...row,
                                  skill: e.target.value as ItemInput["skill"],
                                }
                              : row,
                          ),
                        )
                      }
                    >
                      {["听", "说", "读", "写"].map((skill) => (
                        <option key={skill}>{skill}</option>
                      ))}
                    </select>
                  </label>
                  <Field
                    label={`题目 ${index + 1} 薄弱项标签`}
                    value={item.tag}
                    onChange={(value) =>
                      setItems((old) =>
                        old.map((row, i) =>
                          i === index ? { ...row, tag: value } : row,
                        ),
                      )
                    }
                  />
                  <Field
                    label={`题目 ${index + 1} 实际答案`}
                    value={item.answer}
                    onChange={(value) =>
                      setItems((old) =>
                        old.map((row, i) =>
                          i === index ? { ...row, answer: value } : row,
                        ),
                      )
                    }
                  />
                  <label className="form-field">
                    题目 {index + 1} 结果
                    <select
                      aria-label={`题目 ${index + 1} 结果`}
                      value={item.outcome}
                      onChange={(e) =>
                        setItems((old) =>
                          old.map((row, i) =>
                            i === index
                              ? {
                                  ...row,
                                  outcome: e.target
                                    .value as ItemInput["outcome"],
                                }
                              : row,
                          ),
                        )
                      }
                    >
                      <option value="correct">正确</option>
                      <option value="incorrect">错误</option>
                      <option value="unscored">未评分</option>
                    </select>
                  </label>
                  {item.outcome === "incorrect" && (
                    <Field
                      label={`题目 ${index + 1} 错误类型`}
                      value={item.errorType ?? ""}
                      onChange={(value) =>
                        setItems((old) =>
                          old.map((row, i) =>
                            i === index ? { ...row, errorType: value } : row,
                          ),
                        )
                      }
                    />
                  )}
                </fieldset>
              ))}
              <button
                type="button"
                className="button"
                disabled={busy || items.length >= 100}
                onClick={() => setItems((old) => [...old, emptyItem()])}
              >
                增加题目
              </button>
            </>
          )}
          <button className="button primary" disabled={busy}>
            {assessmentEdit ? "保存测评更正" : "保存测评与作答"}
          </button>
          {assessmentEdit && (
            <button
              type="button"
              className="button"
              onClick={() => {
                setAssessmentEdit(null);
                setItems([emptyItem()]);
              }}
            >
              取消测评更正
            </button>
          )}
        </form>
        {report?.assessments.map((row) => (
          <div className="loop-record" key={row.entity.id}>
            <strong>{row.entity.title}</strong>
            <span>
              {row.data.category} · {row.data.phase} · 首答 {row.firstCount} /
              重复 {row.repeatedCount} · {statusLabel(row.sampleStatus)}
            </span>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => editAssessment(row.entity, row.data)}
            >
              更正测评 · {row.entity.title}
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void run(
                  () => recycle(row.entity, true),
                  "测评已删除，作答暴露历史保留。",
                )
              }
            >
              删除测评 · {row.entity.title}
            </button>
          </div>
        ))}
      </details>
      <details open>
        <summary>薄弱项证据与可比性</summary>
        {report?.weaknesses.map((row) => (
          <div className="loop-record" key={row.language + row.skill + row.tag}>
            <strong>
              {row.skill} · {row.tag}
            </strong>
            <span>
              独立题目 {row.samples} · 错误作答次数（含重复） {row.incorrect} ·
              重复 {row.repeated} · {statusLabel(row.sampleStatus)}
            </span>
            <p>{row.errorTypes.join("；")}</p>
            {row.evidenceIds.map((id) => (
              <button
                key={id}
                className="text-button"
                onClick={() => props.onOpen(id)}
              >
                {entities.find((e) => e.id === id)?.title ?? id}
              </button>
            ))}
          </div>
        ))}
        {report?.comparisons.map((row) => (
          <div className="loop-comparison" key={row.baselineId + row.retestId}>
            <strong>
              {entities.find((e) => e.id === row.baselineId)?.title} →{" "}
              {entities.find((e) => e.id === row.retestId)?.title}：
              {row.comparable ? "条件可比" : "不可比"}
            </strong>
            <p>
              {row.reasons.join("；") ||
                `同协议的新题描述性比较${row.scoreDelta === undefined ? "" : `，报告分数差 ${row.scoreDelta}`}。`}
            </p>
            <p>
              {statusLabel(row.sampleStatus)} · {row.conclusion}
            </p>
          </div>
        ))}
      </details>
      <details>
        <summary>教师分身摘要 · 手工或文件导入</summary>
        <p>
          按 life-os-teacher-summary-v1 契约保存来源
          ID、单调修订、原文与人工摘要。聊天转写不形成发音评分；新来源修订先核对当前稿并勾选审核，版本冲突时保留输入、重新读取再核对。
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () =>
                importTeacher({
                  protocol: "life-os-teacher-summary-v1",
                  source: {
                    namespace: teacherSource,
                    id: teacherId,
                    revision: Number(teacherRevision),
                  },
                  language,
                  ...stamp,
                  originalText: original,
                  summary: teacherSummary,
                  modality: modality as TeacherContract["modality"],
                  recommendations: recommendations
                    .split("\n")
                    .filter((value) => value.trim()),
                  sessionIds: assessmentSession ? [assessmentSession] : [],
                  goalIds,
                }),
              "教师原文和来源修订已保存，仍为未核实摘要。",
            );
          }}
        >
          <div className="form-row">
            <Field
              label="教师来源名称"
              value={teacherSource}
              onChange={setTeacherSource}
            />
            <Field
              label="教师来源记录 ID"
              value={teacherId}
              onChange={setTeacherId}
            />
            <Field
              label="教师来源修订号"
              type="number"
              value={teacherRevision}
              onChange={setTeacherRevision}
            />
          </div>
          <label className="form-field">
            教师材料方式
            <select
              aria-label="教师材料方式"
              value={modality}
              onChange={(e) => setModality(e.target.value)}
            >
              <option value="text">文字材料</option>
              <option value="chat-transcript">聊天转写</option>
              <option value="human-audio-observation">
                人工听音观察（无自动评分）
              </option>
            </select>
          </label>
          <Text label="教师原文" value={original} onChange={setOriginal} />
          <Text
            label="教师人工摘要"
            value={teacherSummary}
            onChange={setTeacherSummary}
          />
          <Text
            label="教师建议（一行一项）"
            value={recommendations}
            onChange={setRecommendations}
          />
          <label className="check-field">
            <input
              aria-label="已核对当前教师稿"
              type="checkbox"
              checked={reviewedTeacher}
              onChange={(e) => setReviewedTeacher(e.target.checked)}
            />
            已核对当前教师稿，接受此新来源修订替换当前稿（历史保留）
          </label>
          <button className="button" disabled={busy}>
            导入教师手工摘要
          </button>
        </form>
        <label className="form-field">
          教师契约 JSON 文件
          <input
            aria-label="教师契约 JSON 文件"
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file)
                void run(async () => {
                  if (file.size > 20000)
                    throw Error("教师契约文件超过 20000 字节");
                  setTeacherJson(await file.text());
                }, "文件已读取，核对后导入。");
            }}
          />
        </label>
        <Text
          label="教师契约 JSON"
          value={teacherJson}
          onChange={setTeacherJson}
        />
        <button
          className="button"
          disabled={busy}
          onClick={() =>
            void run(
              () => importTeacher(JSON.parse(teacherJson)),
              "教师契约已导入，来源及原文历史保留。",
            )
          }
        >
          导入教师契约 JSON
        </button>
        {report?.teacherSummaries.map((row) => (
          <article key={row.entity.id} className="loop-record">
            <strong>
              {row.entity.title} · 来源修订 {row.data.contract.source.revision}
            </strong>
            <p>{row.data.summary}</p>
            <button
              className="text-button"
              onClick={() => {
                setTeacherEdit(row.entity);
                setTeacherEditText(row.data.summary);
              }}
            >
              更正教师摘要 · {row.entity.title}
            </button>
            <details>
              <summary>查看教师原文与修订历史</summary>
              {row.revisions.map((rev) => (
                <div key={rev.version}>
                  <p>
                    记录版本 {rev.version} · 来源修订 {rev.sourceRevision}
                  </p>
                  <pre>{rev.originalText}</pre>
                  <p>{rev.summary}</p>
                </div>
              ))}
            </details>
          </article>
        ))}
        {teacherEdit && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await command("/api/learning-loop/teacher-edit", {
                  entityId: teacherEdit.id,
                  expectedVersion: teacherEdit.version,
                  expectedNoteHash: teacherEdit.noteHash,
                  summary: teacherEditText,
                });
                setTeacherEdit(null);
              }, "已更正教师摘要，原文和旧稿保留。");
            }}
          >
            <Text
              label="更正后的教师摘要"
              value={teacherEditText}
              onChange={setTeacherEditText}
            />
            <button className="button" disabled={busy}>
              保存教师摘要更正
            </button>
          </form>
        )}
      </details>
      <details>
        <summary>人工方法调整与采纳历史</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await command("/api/learning-loop/methods", {
                ...common("方法调整建议"),
                method,
                reason: methodReason,
                evidenceIds: methodEvidence,
                ...(candidate() ? { candidate: candidate() } : {}),
              });
              setMethod("");
              setMethodReason("");
            }, "方法建议已保存为草稿，需你明确采纳。");
          }}
        >
          <Text label="拟调整的方法" value={method} onChange={setMethod} />
          <Text
            label="调整理由与证据解释"
            value={methodReason}
            onChange={setMethodReason}
          />
          <fieldset>
            <legend>方法依据 · 选择实际记录</legend>
            {entities
              .filter(
                (e) =>
                  !e.deleted &&
                  e.kind !== "plan" &&
                  [
                    "attempt",
                    "assessment",
                    "teacher-summary",
                    "practice",
                    "expression",
                  ].includes(e.type),
              )
              .map((e) => (
                <label className="check-field" key={e.id}>
                  <input
                    type="checkbox"
                    aria-label={`方法依据 ${e.title}`}
                    checked={methodEvidence.includes(e.id)}
                    onChange={(event) =>
                      setMethodEvidence((old) =>
                        event.target.checked
                          ? [...old, e.id]
                          : old.filter((id) => id !== e.id),
                      )
                    }
                  />
                  {e.title}
                </label>
              ))}
          </fieldset>
          <button className="button" disabled={busy}>
            保存方法建议
          </button>
        </form>
        {report?.methods.map((row) => (
          <article className="loop-record" key={row.entity.id}>
            <strong>
              {row.entity.kind === "inference"
                ? report?.methods.some(
                    (other) =>
                      other.entity.kind === "plan" &&
                      other.data.proposalId === row.entity.id,
                  )
                  ? "已保留采纳历史的原建议"
                  : "待人工采纳"
                : row.entity.status === "failed"
                  ? "已撤销"
                  : "已人工采纳"}{" "}
              · {row.data.method}
            </strong>
            <p>{row.data.reason}</p>
            {row.entity.kind === "inference" &&
              !report?.methods.some(
                (other) =>
                  other.entity.kind === "plan" &&
                  other.data.proposalId === row.entity.id,
              ) && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await command("/api/learning-loop/method-actions", {
                        ...editing(row.entity),
                        ...now(),
                        action: "adopt",
                      });
                    }, "已明确采纳，旧方法与建议仍可回看。")
                  }
                >
                  人工采纳此方法
                </button>
              )}
            {row.entity.kind === "plan" && row.entity.status === "active" && (
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await command("/api/learning-loop/method-actions", {
                      ...editing(row.entity),
                      ...now(),
                      action: "withdraw",
                    });
                  }, "采纳已撤销，历史完整保留。")
                }
              >
                撤销此方法采纳
              </button>
            )}
          </article>
        ))}
      </details>
      <details>
        <summary>闭环回收站</summary>
        {entities
          .filter(
            (e) =>
              e.deleted &&
              e.module === "languages" &&
              [
                "practice",
                "assessment",
                "attempt",
                "teacher-summary",
                "method-adjustment",
                "learning-config",
              ].includes(e.type),
          )
          .map((e) => (
            <div className="loop-record" key={e.id}>
              <span>{e.title}</span>
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => recycle(e, false),
                    "已明确恢复原记录，时长按原所有者去重。",
                  )
                }
              >
                恢复闭环记录 · {e.title}
              </button>
            </div>
          ))}
      </details>
      {!!report?.issues.length && (
        <aside role="status">
          <h3>保留记录中的问题</h3>
          <ul>
            {report.issues.map((issue, index) => (
              <li key={index}>
                {entities.find((e) => e.id === issue.entityId)?.title ??
                  issue.entityId}
                ：{issue.message}
              </li>
            ))}
          </ul>
        </aside>
      )}
    </section>
  );
}
