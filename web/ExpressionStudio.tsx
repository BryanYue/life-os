import React, { useRef, useState } from "react";
import type { Entity, Module } from "../src/types.js";
import type {
  ExpressionStructure as Structure,
  ExpressionCoverage as Coverage,
  ExpressionFeedback as Feedback,
  expressionReport,
} from "../src/expression.js";
import type { SpecialistProps } from "./SpecialistPanels.js";
import { BuiltinUpgradePrompt, browserNow } from "./ReadingWorkspace.js";
import { LocalDateTimeField } from "./LocalDateTimeField.js";

type Evidence = { text: string; sourceId?: string; reference?: string };
type Report = ReturnType<typeof expressionReport>;
type Props = SpecialistProps & { modules: Module[] };
const emptyStructure = (): Structure => ({ claim: "", groups: [] });
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const message = (error: unknown) =>
  error instanceof Error ? error.message : "请求未完成，请重试。";
function readStructure(entity: Entity): Structure | null {
  if (!entity.fields.structure) return emptyStructure();
  try {
    const value: unknown = JSON.parse(String(entity.fields.structure));
    if (!value || typeof value !== "object") return null;
    const candidate = value as Structure;
    if (
      typeof candidate.claim !== "string" ||
      !Array.isArray(candidate.groups) ||
      !candidate.groups.every(
        (group) =>
          typeof group.reason === "string" &&
          Array.isArray(group.evidence) &&
          group.evidence.every(
            (item) =>
              typeof item.text === "string" &&
              (item.sourceId === undefined ||
                typeof item.sourceId === "string") &&
              (item.reference === undefined ||
                typeof item.reference === "string"),
          ),
      )
    )
      return null;
    return candidate;
  } catch {
    return null;
  }
}
function Source({
  id,
  entities,
  onOpen,
}: Pick<Props, "entities" | "onOpen"> & { id: string }) {
  const entity = entities.find((item) => item.id === id && !item.deleted);
  return entity ? (
    <button
      type="button"
      className="text-button source-link"
      onClick={() => onOpen(id)}
    >
      {entity.title}
    </button>
  ) : (
    <code className="source-id">来源不可用 · {id}</code>
  );
}
function CoverageView({ value }: { value: Coverage }) {
  return (
    <dl className="expression-coverage">
      <div>
        <dt>核心观点</dt>
        <dd>{value.hasClaim ? "已填写" : "待补充"}</dd>
      </div>
      <div>
        <dt>理由组</dt>
        <dd>{value.reasonGroups}</dd>
      </div>
      <div>
        <dt>含依据的理由组</dt>
        <dd>{value.groupsWithEvidence}</dd>
      </div>
      <div>
        <dt>依据条目</dt>
        <dd>{value.evidenceItems}</dd>
      </div>
      <div>
        <dt>含来源或引用的依据</dt>
        <dd>{value.referencedEvidenceItems}</dd>
      </div>
    </dl>
  );
}

export function ExpressionStudio(props: Props) {
  const [saved, setSaved] = useState<Entity | null>(null);
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"文字" | "口头文字记录">("文字");
  const [original, setOriginal] = useState("");
  const [structure, setStructure] = useState<Structure>(emptyStructure);
  const [revised, setRevised] = useState("");
  const [status, setStatus] = useState<"active" | "done">("active");
  const [materialId, setMaterialId] = useState("");
  const [goalIds, setGoalIds] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => browserNow());
  const [timeZone, setTimeZone] = useState(zone);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retryPending, setRetryPending] = useState(false);
  const [structureInvalid, setStructureInvalid] = useState(false);
  // A lost HTTP response must reuse the complete original request, including its ID.
  const pending = useRef<{ path: string; body: unknown } | null>(null);
  const live = props.entities.filter((item) => !item.deleted);
  const practices = live.filter(
    (item) =>
      item.module === "learning" &&
      item.type === "expression" &&
      item.kind === "fact",
  );
  const materials = live.filter(
    (item) => item.module === "learning" && item.type === "material",
  );
  const sessions = live.filter(
    (item) =>
      item.module === "learning" &&
      item.type === "session" &&
      item.kind === "fact",
  );
  const goals = live.filter(
    (item) =>
      item.kind === "plan" &&
      item.status === "active" &&
      (item.type === "goal" ||
        (item.module === "planning" && item.type === "direction") ||
        (item.module === "languages" && item.type === "language-goal")),
  );
  const locked = props.busy || retryPending;
  const editableOriginal = !locked && !saved;
  const dirty =
    !!saved &&
    (JSON.stringify(readStructure(saved)) !== JSON.stringify(structure) ||
      String(saved.fields.revisedText ?? "") !== revised ||
      saved.status !== status);
  const module = props.modules.find((item) => item.id === "learning");

  function editStructure(value: Structure) {
    setStructure(value);
    setFeedback(null);
    setNotice("");
  }
  function evidenceEdit(
    groupIndex: number,
    evidenceIndex: number,
    patch: Partial<Evidence>,
  ) {
    editStructure({
      ...structure,
      groups: structure.groups.map((group, index) =>
        index === groupIndex
          ? {
              ...group,
              evidence: group.evidence.map((item, itemIndex) =>
                itemIndex === evidenceIndex ? { ...item, ...patch } : item,
              ),
            }
          : group,
      ),
    });
  }
  function load(entity: Entity) {
    const parsed = readStructure(entity);
    setSaved(entity);
    setTitle(entity.title);
    setMode(entity.fields.mode === "口头文字记录" ? "口头文字记录" : "文字");
    setOriginal(entity.body);
    setStructure(parsed ?? emptyStructure());
    setStructureInvalid(parsed === null);
    setRevised(String(entity.fields.revisedText ?? ""));
    setStatus(entity.status === "done" ? "done" : "active");
    setMaterialId(
      entity.relations.find(
        (relation) =>
          relation.type === "related" &&
          materials.some((item) => item.id === relation.target),
      )?.target ?? "",
    );
    setGoalIds(
      entity.relations
        .filter((relation) => relation.type === "supports")
        .map((relation) => relation.target),
    );
    setSessionId(
      entity.relations.find(
        (relation) =>
          relation.type === "evidence" &&
          sessions.some((item) => item.id === relation.target),
      )?.target ?? "",
    );
    setOccurredAt(entity.occurredAt);
    setTimeZone(entity.timeZone);
    setFeedback(null);
    setError("");
    setNotice("");
  }
  function fresh() {
    setSaved(null);
    setTitle("");
    setMode("文字");
    setOriginal("");
    setStructure(emptyStructure());
    setRevised("");
    setStatus("active");
    setMaterialId("");
    setGoalIds([]);
    setSessionId("");
    setOccurredAt(browserNow());
    setTimeZone(zone());
    setFeedback(null);
    setError("");
    setNotice("");
    setStructureInvalid(false);
  }
  function save() {
    void props.run(async () => {
      if (!pending.current) {
        const operationId = crypto.randomUUID();
        pending.current = saved
          ? {
              path: "/api/expression/revise",
              body: {
                operationId,
                id: saved.id,
                expectedVersion: saved.version,
                expectedNoteHash: saved.noteHash,
                structure,
                revisedText: revised,
                status,
              },
            }
          : {
              path: "/api/expression/create",
              body: {
                operationId,
                title,
                mode,
                originalText: original,
                structure,
                revisedText: revised,
                status,
                ...(materialId ? { materialId } : {}),
                goalIds,
                ...(sessionId ? { sessionId } : {}),
                occurredAt,
                timeZone,
              },
            };
      }
      setError("");
      let entity: Entity;
      try {
        entity = await props.request<Entity>(
          pending.current.path,
          pending.current.body,
        );
      } catch (caught) {
        setRetryPending(true);
        setError(`${message(caught)} 文本已保留；重试将使用同一保存编号。`);
        throw caught;
      }
      pending.current = null;
      setRetryPending(false);
      load(entity);
      setReport(null);
      setNotice(
        `已保存第 ${entity.version} 版。原稿保留，表达练习不新增学习分钟。`,
      );
      await props.onImported();
    });
  }
  async function read<T>(path: string, apply: (value: T) => void) {
    setError("");
    try {
      apply(await props.request<T>(path));
    } catch (caught) {
      setError(message(caught));
      throw caught;
    }
  }

  if (
    !module ||
    module.schemaVersion < 2 ||
    !module.entityTypes.some((item) => item.id === "expression")
  )
    return <BuiltinUpgradePrompt {...props} requiredModules={["learning"]} />;

  return (
    <details
      className="specialist-panel expression-studio"
      aria-label="思考与表达"
    >
      <summary>
        思考与表达 <span>先留下想法，再逐步整理</span>
      </summary>
      <section aria-label="表达工作台">
        <div className="section-heading">
          <div>
            <h2>让想法有据可循</h2>
            <p>
              自由记录文字或口头表达的文字记录，再按需要整理观点、理由和依据。口头文字记录需自行输入，不录音或转录。
            </p>
          </div>
          {saved && (
            <button
              type="button"
              className="button secondary"
              disabled={locked || dirty}
              onClick={fresh}
            >
              新一篇表达
            </button>
          )}
        </div>
        {practices.length > 0 && (
          <details className="expression-history">
            <summary>已有表达 · {practices.length} 篇</summary>
            <div className="expression-stack">
              {practices.map((item) => (
                <div className="report-card" key={item.id}>
                  <strong>{item.title}</strong>
                  <p>
                    {String(item.fields.mode)} · 第 {item.version} 版 ·{" "}
                    {item.status === "done" ? "已完成" : "进行中"}
                  </p>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={locked || dirty}
                    onClick={() => load(item)}
                  >
                    继续整理 · {item.title}
                  </button>
                  <Source id={item.id} {...props} />
                </div>
              ))}
            </div>
          </details>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <div className="expression-grid">
            <label className="form-field">
              表达标题
              <input
                aria-label="表达标题"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={!editableOriginal}
                required
                maxLength={200}
                placeholder="这次想说清楚什么？"
              />
            </label>
            <label className="form-field">
              练习方式
              <select
                aria-label="练习方式"
                value={mode}
                disabled={!editableOriginal}
                onChange={(event) => setMode(event.target.value as typeof mode)}
              >
                <option>文字</option>
                <option>口头文字记录</option>
              </select>
            </label>
          </div>
          <label className="form-field expression-original">
            自由原稿
            <textarea
              aria-label="自由原稿"
              value={original}
              onChange={(event) => setOriginal(event.target.value)}
              readOnly={!!saved}
              disabled={locked}
              required
              rows={8}
              placeholder="不必先有完整结构，把想到的话写下来。"
            />
          </label>
          {saved && (
            <p className="form-help">
              本次整理保留原稿。当前第 {saved.version} 版 ·{" "}
              <Source id={saved.id} {...props} />
            </p>
          )}
          <details className="expression-context">
            <summary>
              来源与关联 <span>可选，不自动创建目标或计时记录</span>
            </summary>
            <div className="expression-grid">
              <label className="form-field">
                源材料
                <select
                  aria-label="源材料"
                  value={materialId}
                  disabled={!editableOriginal}
                  onChange={(event) => setMaterialId(event.target.value)}
                >
                  <option value="">不关联材料</option>
                  {materials.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                已有学习记录
                <select
                  aria-label="已有学习记录"
                  value={sessionId}
                  disabled={!editableOriginal}
                  onChange={(event) => setSessionId(event.target.value)}
                >
                  <option value="">不关联学习记录</option>
                  {sessions.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.title} · {item.fields.minutes ?? 0} 分钟
                    </option>
                  ))}
                </select>
              </label>
              <LocalDateTimeField
                label="表达发生时间"
                value={occurredAt}
                timeZone={timeZone}
                onChange={setOccurredAt}
                required
                disabled={!editableOriginal}
              />
              <label className="form-field">
                记录时区
                <input aria-label="记录时区" value={timeZone} readOnly />
                <small>
                  {saved
                    ? "保留此记录的原始时区。"
                    : "按本机时区显示日期时间，自动保存对应时差。"}
                </small>
              </label>
            </div>
            <fieldset className="expression-goals">
              <legend>跨领域目标（可多选）</legend>
              {goals.length === 0 ? (
                <p className="form-help">
                  暂无目标。可以先保存表达，目标不会自动创建。
                </p>
              ) : (
                goals.map((item) => (
                  <label className="check-field" key={item.id}>
                    <input
                      aria-label={`${props.modules.find((candidate) => candidate.id === item.module)?.name ?? item.module} · ${item.title}`}
                      type="checkbox"
                      checked={goalIds.includes(item.id)}
                      disabled={!editableOriginal}
                      onChange={(event) =>
                        setGoalIds(
                          event.target.checked
                            ? [...goalIds, item.id]
                            : goalIds.filter((id) => id !== item.id),
                        )
                      }
                    />
                    {props.modules.find(
                      (candidate) => candidate.id === item.module,
                    )?.name ?? item.module}{" "}
                    · {item.title}
                  </label>
                ))
              )}
            </fieldset>
            {materialId && (
              <p>
                材料：
                <Source id={materialId} {...props} />
              </p>
            )}
            {sessionId && (
              <p>
                已有计时记录：
                <Source id={sessionId} {...props} />
              </p>
            )}
          </details>
          <details className="expression-structure">
            <summary>
              整理观点、理由与依据{" "}
              <span>{structure.groups.length} 组理由 · 数量由你决定</span>
            </summary>
            {structureInvalid ? (
              <p className="report-warning">
                这条记录的结构格式无法读取，请通过记录编辑器检查后重新载入。
                <Source id={saved!.id} {...props} />
              </p>
            ) : (
              <div className="expression-stack">
                <label className="form-field">
                  核心观点
                  <textarea
                    aria-label="核心观点"
                    rows={3}
                    value={structure.claim}
                    disabled={locked}
                    onChange={(event) =>
                      editStructure({ ...structure, claim: event.target.value })
                    }
                    placeholder="你最想让读者理解的观点（可留空）"
                  />
                </label>
                {structure.groups.length === 0 && (
                  <p className="form-help">
                    可以直接保存自由原稿，也可以添加任意数量的理由组。
                  </p>
                )}
                {structure.groups.map((group, groupIndex) => (
                  <fieldset className="expression-reason-card" key={groupIndex}>
                    <legend>理由组 {groupIndex + 1}</legend>
                    <label className="form-field">
                      理由 {groupIndex + 1}
                      <textarea
                        aria-label={`理由 ${groupIndex + 1}`}
                        rows={3}
                        value={group.reason}
                        disabled={locked}
                        onChange={(event) =>
                          editStructure({
                            ...structure,
                            groups: structure.groups.map((item, index) =>
                              index === groupIndex
                                ? { ...item, reason: event.target.value }
                                : item,
                            ),
                          })
                        }
                      />
                    </label>
                    {group.evidence.map((item, evidenceIndex) => (
                      <div className="expression-evidence" key={evidenceIndex}>
                        <label className="form-field">
                          依据 {groupIndex + 1}.{evidenceIndex + 1}
                          <textarea
                            aria-label={`依据 ${groupIndex + 1}.${evidenceIndex + 1}`}
                            rows={3}
                            disabled={locked}
                            value={item.text}
                            onChange={(event) =>
                              evidenceEdit(groupIndex, evidenceIndex, {
                                text: event.target.value,
                              })
                            }
                          />
                        </label>
                        <div className="expression-grid">
                          <label className="form-field">
                            依据来源 {groupIndex + 1}.{evidenceIndex + 1}
                            <select
                              aria-label={`依据来源 ${groupIndex + 1}.${evidenceIndex + 1}`}
                              value={item.sourceId ?? ""}
                              disabled={locked}
                              onChange={(event) =>
                                evidenceEdit(groupIndex, evidenceIndex, {
                                  sourceId: event.target.value || undefined,
                                })
                              }
                            >
                              <option value="">未关联来源</option>
                              {item.sourceId &&
                                !live.some(
                                  (entity) => entity.id === item.sourceId,
                                ) && (
                                  <option value={item.sourceId}>
                                    不可用来源 · {item.sourceId}
                                  </option>
                                )}
                              {live
                                .filter((entity) => entity.id !== saved?.id)
                                .map((entity) => (
                                  <option value={entity.id} key={entity.id}>
                                    {entity.title} ·{" "}
                                    {
                                      {
                                        fact: "事实",
                                        inference: "推断",
                                        plan: "计划",
                                      }[entity.kind]
                                    }
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label className="form-field">
                            引用位置 {groupIndex + 1}.{evidenceIndex + 1}
                            <input
                              aria-label={`引用位置 ${groupIndex + 1}.${evidenceIndex + 1}`}
                              value={item.reference ?? ""}
                              disabled={locked}
                              onChange={(event) =>
                                evidenceEdit(groupIndex, evidenceIndex, {
                                  reference: event.target.value || undefined,
                                })
                              }
                              placeholder="页码、段落或出处（可选）"
                            />
                          </label>
                        </div>
                        {item.sourceId && (
                          <Source id={item.sourceId} {...props} />
                        )}
                        <button
                          type="button"
                          className="text-button"
                          disabled={locked}
                          onClick={() =>
                            editStructure({
                              ...structure,
                              groups: structure.groups.map(
                                (candidate, index) =>
                                  index === groupIndex
                                    ? {
                                        ...candidate,
                                        evidence: candidate.evidence.filter(
                                          (_, itemIndex) =>
                                            itemIndex !== evidenceIndex,
                                        ),
                                      }
                                    : candidate,
                              ),
                            })
                          }
                        >
                          删除依据 {groupIndex + 1}.{evidenceIndex + 1}
                        </button>
                      </div>
                    ))}
                    <div className="expression-actions">
                      <button
                        type="button"
                        className="button secondary"
                        disabled={locked}
                        onClick={() =>
                          editStructure({
                            ...structure,
                            groups: structure.groups.map((candidate, index) =>
                              index === groupIndex
                                ? {
                                    ...candidate,
                                    evidence: [
                                      ...candidate.evidence,
                                      { text: "" },
                                    ],
                                  }
                                : candidate,
                            ),
                          })
                        }
                      >
                        添加依据 · 理由组 {groupIndex + 1}
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        disabled={locked}
                        onClick={() =>
                          editStructure({
                            ...structure,
                            groups: structure.groups.filter(
                              (_, index) => index !== groupIndex,
                            ),
                          })
                        }
                      >
                        删除理由组 {groupIndex + 1}
                      </button>
                    </div>
                  </fieldset>
                ))}
                <button
                  type="button"
                  className="button secondary"
                  disabled={locked}
                  onClick={() =>
                    editStructure({
                      ...structure,
                      groups: [
                        ...structure.groups,
                        { reason: "", evidence: [] },
                      ],
                    })
                  }
                >
                  添加理由组
                </button>
              </div>
            )}
          </details>
          <details className="expression-revision">
            <summary>整理后文稿与原稿对照</summary>
            <div className="expression-comparison">
              <div>
                <h3>保留的原稿</h3>
                <p className="expression-text">
                  {original || "原稿尚未填写。"}
                </p>
              </div>
              <label className="form-field">
                整理后文稿
                <textarea
                  aria-label="整理后文稿"
                  rows={10}
                  disabled={locked || structureInvalid}
                  value={revised}
                  onChange={(event) => {
                    setRevised(event.target.value);
                    setFeedback(null);
                    setNotice("");
                  }}
                  placeholder="用自己的表达整理文稿；原稿会保留。"
                />
              </label>
            </div>
          </details>
          <div className="expression-actions">
            <label className="form-field">
              表达状态
              <select
                aria-label="表达状态"
                value={status}
                disabled={locked || structureInvalid}
                onChange={(event) => {
                  setStatus(event.target.value as typeof status);
                  setFeedback(null);
                }}
              >
                <option value="active">继续整理</option>
                <option value="done">已完成</option>
              </select>
            </label>
            <button
              className="button"
              disabled={
                props.busy ||
                structureInvalid ||
                !original.trim() ||
                !title.trim() ||
                !occurredAt ||
                (!!saved && !dirty && !retryPending)
              }
            >
              {retryPending
                ? "重试保存（同一操作）"
                : saved
                  ? "保存整理版本"
                  : "保存原稿"}
            </button>
          </div>
        </form>
        {error && (
          <p role="alert" className="report-warning">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="import-result">
            {notice}
          </p>
        )}
        {saved && (
          <section className="expression-feedback" aria-label="表达结构反馈">
            <div className="expression-actions">
              <button
                className="button secondary"
                disabled={locked || dirty || structureInvalid}
                onClick={() =>
                  void props.run(() =>
                    read<Feedback>(
                      `/api/expression/${encodeURIComponent(saved.id)}/feedback`,
                      setFeedback,
                    ),
                  )
                }
              >
                查看结构反馈
              </button>
              <span className="form-help">
                {dirty
                  ? "请先保存整理版本，反馈依据已保存内容。"
                  : `依据已保存的第 ${saved.version} 版 · 规则推断（inference）`}
              </span>
            </div>
            {feedback && (
              <div className="expression-feedback-result">
                <h3>结构反馈 · 推断（inference）</h3>
                <p className="form-help">
                  来源：当前表达记录及已关联的本地记录。结构检查不判断论点真实性、来源内容是否准确或表达质量。
                </p>
                <CoverageView value={feedback.coverage} />
                <details open={feedback.issues.length > 0}>
                  <summary>待核对事项 · {feedback.issues.length}</summary>
                  {feedback.issues.length === 0 ? (
                    <p>未发现当前规则可识别的结构缺口。</p>
                  ) : (
                    <ul>
                      {feedback.issues.map((issue, index) => (
                        <li key={index}>
                          {issue.groupIndex !== undefined &&
                            `理由组 ${issue.groupIndex + 1} · `}
                          {issue.evidenceIndex !== undefined &&
                            `依据 ${issue.evidenceIndex + 1} · `}
                          {issue.message}
                          {issue.sourceId && (
                            <Source id={issue.sourceId} {...props} />
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
                <details>
                  <summary>来源核对 · {feedback.sourceChecks.length}</summary>
                  {feedback.sourceChecks.length === 0 ? (
                    <p>尚未关联可核对的依据来源。</p>
                  ) : (
                    feedback.sourceChecks.map((item, index) => (
                      <p key={index}>
                        <Source id={item.sourceId} {...props} /> ·{" "}
                        {
                          {
                            missing: "来源不可用",
                            fact: "事实记录",
                            inference: "推断记录，不可当作已验证事实",
                            plan: "计划记录，尚非已发生事实",
                          }[item.status]
                        }
                      </p>
                    ))
                  )}
                </details>
                <details>
                  <summary>进一步思考</summary>
                  <ul>
                    {feedback.prompts.map((prompt, index) => (
                      <li key={index}>{prompt}</li>
                    ))}
                  </ul>
                </details>
                <details>
                  <summary>整理草稿 · 推断，尚未采纳</summary>
                  <p className="expression-text">
                    {feedback.revisedDraft.text || "尚无可供整理的草稿。"}
                  </p>
                  <button
                    className="button secondary"
                    disabled={locked || !feedback.revisedDraft.text}
                    onClick={() => {
                      setRevised(feedback.revisedDraft.text);
                      setFeedback(null);
                      setNotice(
                        "推断草稿已放入整理后文稿，请展开对照、审阅并自行保存。原稿保留。",
                      );
                    }}
                  >
                    将草稿放入整理区，待我审阅
                  </button>
                </details>
                <details>
                  <summary>反馈限制</summary>
                  <ul>
                    {feedback.limitations.map((limitation, index) => (
                      <li key={index}>{limitation}</li>
                    ))}
                  </ul>
                </details>
              </div>
            )}
          </section>
        )}
        <details className="expression-report">
          <summary>表达练习回顾</summary>
          <button
            className="button secondary"
            disabled={locked}
            onClick={() =>
              void props.run(() =>
                read<Report>("/api/reports/expression", setReport),
              )
            }
          >
            查看表达回顾
          </button>
          {report && (
            <div aria-label="表达回顾结果">
              <p className="form-help">
                本地记录汇总 ·
                推断（inference）。表达练习不新增学习分钟，关联已有学习记录只用于回链。
              </p>
              <div className="report-metrics">
                <div>
                  <span>表达练习</span>
                  <strong>{report.practiceCount}</strong>
                </div>
                <div>
                  <span>待整理</span>
                  <strong>{report.unfinished}</strong>
                </div>
                <div>
                  <span>已记录版本变更</span>
                  <strong>{report.recordedVersionChanges}</strong>
                </div>
              </div>
              <p>
                文字 {report.modes.文字} 篇 · 口头文字记录{" "}
                {report.modes.口头文字记录} 篇
              </p>
              {report.rows.map((row) => (
                <details className="report-card" key={row.id}>
                  <summary>
                    {row.title} · 第 {row.version} 版
                  </summary>
                  <Source id={row.id} {...props} />
                  <p>
                    {row.mode} · {row.status === "done" ? "已完成" : "待整理"}
                  </p>
                  <CoverageView value={row.coverage} />
                  <div className="expression-comparison">
                    <div>
                      <h3>原稿</h3>
                      <p className="expression-text">{row.originalText}</p>
                    </div>
                    <div>
                      <h3>整理后文稿</h3>
                      <p className="expression-text">
                        {row.revisedText || "尚未整理"}
                      </p>
                    </div>
                  </div>
                  <div className="expression-source-list">
                    {row.materialIds.map((id) => (
                      <p key={`material-${id}`}>
                        材料：
                        <Source id={id} {...props} />
                      </p>
                    ))}
                    {row.goalIds.map((id) => (
                      <p key={`goal-${id}`}>
                        目标：
                        <Source id={id} {...props} />
                      </p>
                    ))}
                    {row.sessionIds.map((id) => (
                      <p key={`session-${id}`}>
                        已有学习记录：
                        <Source id={id} {...props} />
                      </p>
                    ))}
                  </div>
                </details>
              ))}
              <details>
                <summary>依据来源与已有学习记录</summary>
                {report.sourceEvidenceIds.map((id) => (
                  <p key={`source-${id}`}>
                    依据：
                    <Source id={id} {...props} />
                  </p>
                ))}
                {report.timedSessionIds.map((id) => (
                  <p key={`session-${id}`}>
                    已有学习记录：
                    <Source id={id} {...props} />
                  </p>
                ))}
              </details>
              <details>
                <summary>回顾限制</summary>
                <ul>
                  {report.limitations.map((limitation, index) => (
                    <li key={index}>{limitation}</li>
                  ))}
                </ul>
              </details>
            </div>
          )}
        </details>
      </section>
    </details>
  );
}
