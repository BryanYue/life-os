import React, { useState } from "react";
import type { Entity } from "../src/types.js";
import type {
  Conversion,
  FinanceReport,
  HealthReport,
  AnalyticsIssue,
} from "../src/analytics.js";
import type { compareExperiments } from "../src/research.js";

export type SpecialistProps = {
  request: <T>(path: string, body?: unknown) => Promise<T>;
  run: (work: () => Promise<void>, message?: string) => Promise<void>;
  busy: boolean;
  entities: Entity[];
  onImported: () => Promise<void>;
  onOpen: (id: string) => void;
};
function SourceLink({
  id,
  ...props
}: { id: string } & Pick<SpecialistProps, "entities" | "onOpen">) {
  const entity = props.entities.find((item) => item.id === id);
  return entity ? (
    <button
      className="text-button source-link"
      onClick={() => props.onOpen(id)}
      title={id}
    >
      {entity.title}
    </button>
  ) : (
    <code className="source-id" title="来源记录当前不可用；可复制此ID">
      {id}
    </code>
  );
}
function Issues({
  issues,
  ...props
}: { issues: AnalyticsIssue[] } & Pick<
  SpecialistProps,
  "entities" | "onOpen"
>) {
  return (
    issues.length > 0 && (
      <div className="report-warning" role="status">
        <strong>需核对的记录</strong>
        {issues.map((issue, index) => (
          <p key={index}>
            <SourceLink id={issue.entityId} {...props} /> · {issue.message}
          </p>
        ))}
      </div>
    )
  );
}
function ConversionTable({
  value,
  ...props
}: { value?: Conversion } & Pick<SpecialistProps, "entities" | "onOpen">) {
  if (!value) return null;
  return (
    <div className="conversion-report">
      <p className={value.complete ? "report-total" : "report-warning"}>
        {value.complete
          ? `折算合计 ${value.total} ${value.quoteCurrency}`
          : `折算不完整：已知部分 ${value.partialTotal} ${value.quoteCurrency}，总额待补充汇率`}
      </p>
      {value.lines.length > 0 && (
        <div className="report-scroll">
          <table>
            <thead>
              <tr>
                <th>来源</th>
                <th>原币金额</th>
                <th>折算金额</th>
                <th>汇率证据 / 估值日期</th>
              </tr>
            </thead>
            <tbody>
              {value.lines.map((line, index) => (
                <tr key={index}>
                  <td>
                    <SourceLink id={line.entityId} {...props} />
                  </td>
                  <td>
                    {line.amount} {line.currency}
                  </td>
                  <td>
                    {line.convertedAmount ?? "缺汇率"} {value.quoteCurrency}
                  </td>
                  <td>
                    {line.rate ? (
                      <>
                        <SourceLink
                          id={line.rate.evidence.entityId}
                          {...props}
                        />{" "}
                        · {line.rate.rate} · {line.rate.date} ·{" "}
                        {line.rate.reference}
                      </>
                    ) : line.reason === "same-currency" ? (
                      "同币种"
                    ) : (
                      "需要明确记录的直接汇率"
                    )}
                    <small>{line.valuedAt}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
export function FinancePanel(props: SpecialistProps) {
  const [currency, setCurrency] = useState("");
  const [asOf, setAsOf] = useState("");
  const [report, setReport] = useState<FinanceReport | null>(null);
  return (
    <section className="panel specialist-panel" aria-label="财务报告">
      <div className="section-heading">
        <div>
          <h2>收支与净资产</h2>
          <p>
            收支按原币汇总；账户余额取最近的有效快照。填写目标币种后核对直接汇率来源。
          </p>
        </div>
      </div>
      <form
        className="report-controls"
        onSubmit={(event) => {
          event.preventDefault();
          void props.run(async () => {
            const query = new URLSearchParams();
            if (currency.trim()) query.set("quoteCurrency", currency.trim());
            if (asOf) query.set("asOf", asOf);
            setReport(
              await props.request<FinanceReport>(
                `/api/reports/finance?${query}`,
              ),
            );
          });
        }}
      >
        <label className="form-field">
          折算币种
          <input
            aria-label="折算币种"
            placeholder="例如 USD；留空保留原币"
            value={currency}
            onChange={(event) => {
              setCurrency(event.target.value);
              setReport(null);
            }}
          />
        </label>
        <label className="form-field">
          截至日期
          <input
            type="date"
            value={asOf}
            onChange={(event) => {
              setAsOf(event.target.value);
              setReport(null);
            }}
          />
        </label>
        <button className="button" disabled={props.busy}>
          查看财务报告
        </button>
      </form>
      {report && (
        <>
          <h3 className="report-heading">原币收支记录</h3>
          {!report.entries.length ? (
            <p className="quiet-inline">暂无有效的收支事实。</p>
          ) : (
            <div className="report-scroll">
              <table>
                <thead>
                  <tr>
                    <th>币种</th>
                    <th>类别</th>
                    <th>记录金额合计</th>
                    <th>来源</th>
                  </tr>
                </thead>
                <tbody>
                  {report.entries.map((entry, index) => (
                    <tr key={index}>
                      <td>{entry.currency}</td>
                      <td>{entry.category}</td>
                      <td>{entry.total}</td>
                      <td>
                        {entry.records.map((record) => (
                          <SourceLink
                            key={record.evidence.entityId}
                            id={record.evidence.entityId}
                            {...props}
                          />
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ConversionTable value={report.entryConversion} {...props} />
          <h3 className="report-heading">账户快照与净资产</h3>
          {!report.latest ? (
            <p className="quiet-inline">
              暂无关联账户的有效资产或负债快照。可新建账户，再关联快照。
            </p>
          ) : (
            <>
              <p className="form-help">
                快照日期 {report.latest.date}
                {!report.latest.complete && " · 存在无效快照，结果不完整"}
              </p>
              <div className="report-metrics">
                {report.latest.totals.map((total) => (
                  <div key={total.currency}>
                    <span>{total.currency} 净资产</span>
                    <strong>{total.netWorth}</strong>
                    <small>
                      资产 {total.assets} · 负债 {total.liabilities}
                    </small>
                  </div>
                ))}
              </div>
              <div className="report-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>账户</th>
                      <th>类别</th>
                      <th>余额</th>
                      <th>快照来源</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.latest.accounts.map((account) => (
                      <tr key={account.accountId}>
                        <td>
                          <SourceLink id={account.accountId} {...props} />
                        </td>
                        <td>
                          {account.category} · {account.accountCategory}
                        </td>
                        <td>
                          {account.amount} {account.currency}
                        </td>
                        <td>
                          <SourceLink
                            id={account.evidence.entityId}
                            {...props}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ConversionTable value={report.latest.conversion} {...props} />
              {report.snapshotHistory.length > 1 && (
                <details>
                  <summary>查看净资产历史</summary>
                  <div className="report-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>日期</th>
                          <th>原币净资产</th>
                          <th>折算净资产</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.snapshotHistory.map((point) => (
                          <tr key={point.date}>
                            <td>{point.date}</td>
                            <td>
                              {point.totals
                                .map(
                                  (total) =>
                                    `${total.netWorth} ${total.currency}`,
                                )
                                .join(" / ")}
                            </td>
                            <td>
                              {point.conversion
                                ? point.conversion.complete
                                  ? `${point.conversion.total} ${point.conversion.quoteCurrency}`
                                  : "汇率缺失 / 记录不完整"
                                : "未选择折算币种"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </>
          )}
          <Issues issues={report.issues} {...props} />
        </>
      )}
    </section>
  );
}

type AppleImportReport = {
  imported: Entity[];
  errors: {
    code: string;
    message: string;
    line: number;
    column: number;
    index?: number;
  }[];
  skipped: number;
};
export function HealthPanel(props: SpecialistProps) {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [xml, setXml] = useState("");
  const [timeZone, setTimeZone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [synthetic, setSynthetic] = useState(false);
  const [imported, setImported] = useState<AppleImportReport | null>(null);
  return (
    <section className="panel specialist-panel" aria-label="健康报告">
      <div className="section-heading">
        <div>
          <h2>健康记录与计划对照</h2>
          <p>
            按指标、单位和测量方式分别核对。完成量仅使用状态为已完成的事实。
          </p>
        </div>
        <button
          className="button"
          disabled={props.busy}
          onClick={() =>
            void props.run(async () =>
              setReport(
                await props.request<HealthReport>("/api/reports/health"),
              ),
            )
          }
        >
          查看健康报告
        </button>
      </div>
      {report && (
        <>
          <h3 className="report-heading">指标趋势</h3>
          {!report.trends.length ? (
            <p className="quiet-inline">暂无有效的健康指标事实。</p>
          ) : (
            <div className="report-scroll">
              <table>
                <thead>
                  <tr>
                    <th>指标 / 测量方式</th>
                    <th>起点 → 最近</th>
                    <th>变化</th>
                    <th>来源</th>
                  </tr>
                </thead>
                <tbody>
                  {report.trends.map((trend, index) => (
                    <tr key={index}>
                      <td>
                        {trend.metric} · {trend.unit}
                        <small>{trend.measurement}</small>
                      </td>
                      <td>
                        {trend.points[0]?.value} → {trend.points.at(-1)?.value}
                      </td>
                      <td>{trend.change ?? "需要至少两条记录"}</td>
                      <td>
                        {trend.points.map((point) => (
                          <SourceLink
                            key={point.evidence.entityId}
                            id={point.evidence.entityId}
                            {...props}
                          />
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3 className="report-heading">计划与实际</h3>
          {!report.plans.length ? (
            <p className="quiet-inline">
              暂无健康计划。记录实际时通过“对应计划”关系关联。
            </p>
          ) : (
            report.plans.map((plan) => (
              <article className="report-card" key={plan.plan.entityId}>
                <h3>
                  <SourceLink id={plan.plan.entityId} {...props} />
                </h3>
                <p className="form-help">
                  已记录 {plan.recordedCount} 次 · 已完成 {plan.completedCount}{" "}
                  次
                </p>
                {plan.comparisons.length > 0 && (
                  <div className="report-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>指标</th>
                          <th>计划</th>
                          <th>已记录</th>
                          <th>已完成</th>
                          <th>完成量差值</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.comparisons.map((comparison, index) => (
                          <tr key={index}>
                            <td>
                              {comparison.metric} · {comparison.unit}
                            </td>
                            <td>{comparison.plannedTotal ?? "未填写"}</td>
                            <td>{comparison.recordedTotal}</td>
                            <td>{comparison.completedTotal}</td>
                            <td>
                              {comparison.completedDifference ?? "无法对照"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="report-sources">
                  实际来源：
                  {plan.actuals.length
                    ? plan.actuals.map((actual) => (
                        <SourceLink
                          id={actual.entityId}
                          key={actual.entityId}
                          {...props}
                        />
                      ))
                    : "尚无关联事实"}
                </div>
              </article>
            ))
          )}
          {report.unlinkedActualEntityIds.length > 0 && (
            <details>
              <summary>
                未关联计划的事实（{report.unlinkedActualEntityIds.length}）
              </summary>
              {report.unlinkedActualEntityIds.map((id) => (
                <SourceLink id={id} key={id} {...props} />
              ))}
            </details>
          )}
          <Issues issues={report.issues} {...props} />
        </>
      )}
      <details className="manual-import">
        <summary>手动导入 Apple Health XML</summary>
        <p className="form-help">
          仅处理你选择的 XML
          文件或粘贴内容。时区用于本地记录；错误会显示行列位置。成功记录可从来源链接打开。
        </p>
        <label className="button file-button">
          选择 XML 文件
          <input
            type="file"
            accept=".xml,text/xml,application/xml"
            disabled={props.busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file)
                void props.run(async () => {
                  setXml(await file.text());
                  setImported(null);
                });
            }}
          />
        </label>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void props.run(async () => {
              const result = await props.request<AppleImportReport>(
                "/api/import/apple-health",
                { xml, timeZone, synthetic },
              );
              setImported(result);
              await props.onImported();
              setReport(null);
            });
          }}
        >
          <label className="form-field">
            Apple Health XML 内容
            <textarea
              value={xml}
              onChange={(event) => {
                setXml(event.target.value);
                setImported(null);
              }}
              required
              placeholder="粘贴你手动导出的 XML"
            />
          </label>
          <div className="report-controls">
            <label className="form-field">
              导入时区
              <input
                value={timeZone}
                required
                onChange={(event) => setTimeZone(event.target.value)}
              />
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={synthetic}
                onChange={(event) => setSynthetic(event.target.checked)}
              />
              这些是虚构测试数据
            </label>
            <button className="button" disabled={props.busy || !xml.trim()}>
              导入健康 XML
            </button>
          </div>
        </form>
        {imported && (
          <div className="import-result" role="status">
            <p>
              已导入 {imported.imported.length} 条 · 跳过 {imported.skipped} 条
              · 错误 {imported.errors.length} 项
            </p>
            {imported.imported.map((entity) => (
              <SourceLink id={entity.id} key={entity.id} {...props} />
            ))}
            {imported.errors.map((issue, index) => (
              <p className="report-warning" key={index}>
                {issue.code} · 第 {issue.line} 行 / {issue.column} 列：
                {issue.message}
              </p>
            ))}
          </div>
        )}
      </details>
    </section>
  );
}

type ResearchComparison = ReturnType<typeof compareExperiments>;
const researchLabels: Record<string, string> = {
  status: "执行状态",
  experimentVersion: "实验版本",
  datasetVersion: "数据集版本",
  codeRef: "代码引用",
  parameters: "参数",
  costs: "佣金与滑点假设",
  result: "导入结果",
  evaluation: "评估",
};
const executionLabels: Record<string, string> = {
  "not-run": "未执行",
  succeeded: "成功",
  failed: "失败",
  "in-progress": "进行中",
  inference: "推断",
};
function DataValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "")
    return <span className="subtle">未记录</span>;
  if (typeof value === "object")
    return (
      <div className="structured-values">
        {Object.entries(value).map(([key, child]) => (
          <div key={key}>
            <span>{key}</span>
            <DataValue value={child} />
          </div>
        ))}
      </div>
    );
  return <span>{String(value)}</span>;
}
export function ResearchPanel(props: SpecialistProps & { moduleId: string }) {
  const [text, setText] = useState("");
  const [importedId, setImportedId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [comparison, setComparison] = useState<ResearchComparison | null>(null);
  const experiments = props.entities.filter(
    (entity) =>
      !entity.deleted &&
      entity.module === props.moduleId &&
      entity.type === "experiment",
  );
  return (
    <section className="panel specialist-panel" aria-label="实验研究工具">
      <div className="section-heading">
        <div>
          <h2>实验版本与结果比较</h2>
          <p>
            并排核对实验版本、数据、参数、成本和结果。结果来自记录或手动导入。
          </p>
        </div>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void props.run(async () =>
            setComparison(
              await props.request<ResearchComparison>(
                `/api/research/compare?ids=${selected.map(encodeURIComponent).join(",")}`,
              ),
            ),
          );
        }}
      >
        <label className="form-field">
          选择比较实验（至少两条）
          <select
            multiple
            value={selected}
            onChange={(event) => {
              setSelected(
                Array.from(
                  event.target.selectedOptions,
                  (option) => option.value,
                ),
              );
              setComparison(null);
            }}
          >
            {experiments.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.title} ·{" "}
                {entity.kind === "plan"
                  ? "计划"
                  : entity.kind === "fact"
                    ? "事实"
                    : "推断"}
              </option>
            ))}
          </select>
        </label>
        <button className="button" disabled={props.busy || selected.length < 2}>
          比较实验指标
        </button>
      </form>
      {comparison && (
        <div className="report-scroll">
          <table className="experiment-comparison">
            <thead>
              <tr>
                <th>维度</th>
                {comparison.experiments.map((experiment) => (
                  <th key={experiment.id}>
                    <SourceLink id={experiment.id} {...props} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(researchLabels).map(([key, label]) => (
                <tr
                  className={
                    comparison.differences.includes(
                      key as ResearchComparison["differences"][number],
                    )
                      ? "different-dimension"
                      : ""
                  }
                  key={key}
                >
                  <th>
                    {label}
                    {comparison.differences.includes(
                      key as ResearchComparison["differences"][number],
                    ) && <small>有差异</small>}
                  </th>
                  {comparison.experiments.map((experiment) => (
                    <td key={experiment.id}>
                      <DataValue
                        value={
                          key === "status"
                            ? executionLabels[experiment.status]
                            : experiment[key as keyof typeof experiment]
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {props.moduleId === "quant" && (
        <details className="manual-import">
          <summary>手动导入研究结果</summary>
          <p className="form-help">
            使用 life-os-research-v1 JSON
            文件或文字。需包含身份/修订、假设、实验与数据版本、代码引用、参数、佣金和滑点（bps）、执行状态、结果、发生时间与时区。未执行的计划
            status 为 not-run，result 为 null；执行后以新事实关联 proposalId。
          </p>
          <label className="button file-button">
            选择研究 JSON 文件
            <input
              type="file"
              accept=".json,application/json"
              disabled={props.busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file)
                  void props.run(async () => {
                    setText(await file.text());
                    setImportedId("");
                  });
              }}
            />
          </label>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void props.run(async () => {
                const payload: unknown = JSON.parse(text);
                const result = await props.request<Entity>(
                  "/api/import/research",
                  payload,
                );
                setImportedId(result.id);
                await props.onImported();
                setComparison(null);
              }, "研究记录已导入，可检查来源与执行状态。");
            }}
          >
            <label className="form-field">
              研究结果 JSON
              <textarea
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setImportedId("");
                }}
                placeholder="粘贴 life-os-research-v1 记录"
                required
              />
            </label>
            <button className="button" disabled={props.busy || !text.trim()}>
              导入研究记录
            </button>
          </form>
          {importedId && (
            <div className="import-result">
              已导入：
              <SourceLink id={importedId} {...props} />
            </div>
          )}
        </details>
      )}
    </section>
  );
}
