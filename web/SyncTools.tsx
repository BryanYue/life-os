import React, { useState } from "react";
import type {
  Entity,
  SyncBootstrap,
  SyncProjection,
  SyncScope,
} from "../src/types.js";
import type { SpecialistProps } from "./SpecialistPanels.js";
import { isProjection } from "../src/permissions.js";
export type LocalToolProps = Pick<
  SpecialistProps,
  "request" | "run" | "busy" | "onImported"
>;
type ProjectionView = {
  device: string;
  cursor: number;
  scope: SyncScope;
  records: Entity[];
  readOnly: true;
};
export function StructuredResult({ value }: { value: unknown }) {
  if (value === null || value === undefined)
    return <span className="subtle">无</span>;
  if (Array.isArray(value))
    return value.length ? (
      <div className="result-list">
        {value.map((item, index) => (
          <div key={index}>
            <StructuredResult value={item} />
          </div>
        ))}
      </div>
    ) : (
      <span>0 项</span>
    );
  if (typeof value === "object")
    return (
      <dl className="result-values">
        {Object.entries(value).map(([key, item]) => (
          <React.Fragment key={key}>
            <dt>{key}</dt>
            <dd>
              <StructuredResult value={item} />
            </dd>
          </React.Fragment>
        ))}
      </dl>
    );
  return (
    <span>
      {typeof value === "boolean" ? (value ? "是" : "否") : String(value)}
    </span>
  );
}
function ScopeView({ scope }: { scope: SyncScope }) {
  if (!scope.modules.length)
    return (
      <p className="report-warning">
        当前授权模块为空，没有授权导出业务记录。请在仓库外本地 config.json
        中设置 syncScope，重新启动服务后读取授权。
      </p>
    );
  return (
    <div className="report-scroll">
      <table>
        <thead>
          <tr>
            <th>授权模块</th>
            <th>实体 / 类型</th>
            <th>字段</th>
            <th>正文 / 关系 / 元数据</th>
          </tr>
        </thead>
        <tbody>
          {scope.modules.map((module) => {
            const selection = scope.entities?.[module];
            const unavailable =
              module === "family" || (!!scope.entities && !selection);
            const projectionOnly = isProjection(selection);
            return (
              <tr key={module}>
                <td>{module}</td>
                <td>
                  {unavailable ? (
                    module === "family" ? (
                      "亲属模块不参与同步"
                    ) : (
                      "未指定实体范围，当前无记录授权"
                    )
                  ) : (
                    <>
                      {selection?.entityIds?.join(", ") ?? "全部实体"}
                      <small>
                        {selection?.entityTypes?.join(", ") ?? "全部类型"}
                      </small>
                    </>
                  )}
                </td>
                <td>
                  {unavailable
                    ? "不导出"
                    : (selection?.fields?.join(", ") ?? "全部字段")}
                </td>
                <td>
                  {unavailable
                    ? "不导出"
                    : projectionOnly
                      ? `正文${selection?.body === true ? "允许" : "隐藏"} · 关系${selection?.relations === true ? "允许" : "隐藏"} · 元数据${selection?.metadata?.join(", ") || "隐藏"}`
                      : "完整记录"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
export function SyncTools(props: LocalToolProps) {
  const [scope, setScope] = useState<SyncScope | null>(null);
  const [projections, setProjections] = useState<ProjectionView[]>([]);
  const [kind, setKind] = useState<"bootstrap" | "projection">("bootstrap");
  const [text, setText] = useState("");
  const [acceptManifests, setAcceptManifests] = useState(false);
  const [result, setResult] = useState<{
    mode: string;
    applied: number;
    cursor?: number;
    readOnly?: boolean;
    stale?: boolean;
  } | null>(null);
  async function read() {
    const [packet, views] = await Promise.all([
      props.request<SyncProjection>("/api/sync/projection"),
      props.request<ProjectionView[]>("/api/sync/projections"),
    ]);
    setScope(packet.scope);
    setProjections(views);
  }
  async function download(mode: "bootstrap" | "projection") {
    const packet = await props.request<SyncBootstrap | SyncProjection>(
      `/api/sync/${mode}`,
    );
    setScope(packet.scope);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `life-os-${mode}-${packet.batchId}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="panel specialist-panel" aria-label="本地同步工具">
      <div className="section-heading">
        <div>
          <h2>初始化与只读投影</h2>
          <p>
            本地手动模拟：在你信任的位置交换 JSON
            文件。当前未接通云同步；导出与导入范围由本机仓库外配置决定。
          </p>
        </div>
        <button
          className="button"
          disabled={props.busy}
          onClick={() => void props.run(read)}
        >
          读取授权与投影
        </button>
      </div>
      {scope && (
        <>
          <h3 className="report-heading">当前本地同步授权</h3>
          <ScopeView scope={scope} />
        </>
      )}
      <div className="settings-actions">
        <button
          className="button"
          disabled={props.busy}
          onClick={() =>
            void props.run(
              () => download("bootstrap"),
              "初始化 JSON 已准备下载；仅包含当前本地授权范围。",
            )
          }
        >
          导出初始化 JSON
        </button>
        <button
          className="button"
          disabled={props.busy}
          onClick={() =>
            void props.run(
              () => download("projection"),
              "只读投影 JSON 已准备下载；不会开启云同步。",
            )
          }
        >
          导出只读投影 JSON
        </button>
      </div>
      <details className="manual-import">
        <summary>手动导入初始化或投影 JSON</summary>
        <p className="form-help">
          初始化需要空的接收范围或可重放的已知基线；会检查数据、关系与清单。投影只保存在独立只读区，不会覆盖你的可编辑记录。输入文件的范围不会扩大本地授权。
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void props.run(async () => {
              const packet: unknown = JSON.parse(text);
              const response = await props.request<
                Omit<NonNullable<typeof result>, "mode">
              >(`/api/sync/${kind}`, {
                packet,
                ...(kind === "bootstrap" ? { acceptManifests } : {}),
              });
              setResult({ ...response, mode: kind });
              await read();
              await props.onImported();
            }, "本地 JSON 已处理，请核对实际应用数量和只读状态。");
          }}
        >
          <label className="form-field">
            导入包类型
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as typeof kind);
                setResult(null);
                setAcceptManifests(false);
              }}
            >
              <option value="bootstrap">初始化（bootstrap）</option>
              <option value="projection">只读投影（projection）</option>
            </select>
          </label>
          <label className="button file-button">
            选择同步 JSON 文件
            <input
              aria-label="选择同步 JSON 文件"
              type="file"
              accept=".json,application/json"
              disabled={props.busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file)
                  void props.run(async () => {
                    setText(await file.text());
                    setResult(null);
                  });
              }}
            />
          </label>
          <label className="form-field">
            同步 JSON 内容
            <textarea
              required
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setResult(null);
              }}
              placeholder="粘贴你手动交换的 protocol 2 JSON 包"
            />
          </label>
          {kind === "bootstrap" && (
            <label className="check-field">
              <input
                type="checkbox"
                checked={acceptManifests}
                onChange={(event) => setAcceptManifests(event.target.checked)}
              />
              接受初始化包中的模块清单（acceptManifests）
            </label>
          )}
          {kind === "bootstrap" && (
            <p className="form-help">
              此选项仅接受数据结构清单，不安装或授权可执行插件代码。
            </p>
          )}
          <button className="button" disabled={props.busy || !text.trim()}>
            处理本地同步 JSON
          </button>
        </form>
        {result && (
          <div className="import-result" role="status">
            <p>
              {result.mode === "projection" ? "只读投影" : "初始化基线"} ·
              本次应用 {result.applied} 条{result.readOnly ? " · 只读" : ""}
              {result.stale ? " · 旧游标，未应用" : ""}
              {result.cursor !== undefined ? ` · 游标 ${result.cursor}` : ""}
            </p>
          </div>
        )}
      </details>
      <h3 className="report-heading">已有只读投影</h3>
      {!projections.length ? (
        <p className="quiet-inline">
          {scope
            ? "当前没有已导入的只读投影。"
            : "读取授权与投影后可查看独立只读区。"}
        </p>
      ) : (
        projections.map((view, index) => (
          <article className="projection-card" key={`${view.device}-${index}`}>
            <h3>
              设备 {view.device}{" "}
              <span className="small-chip">
                只读 · {view.records.length} 条
              </span>
            </h3>
            <p className="form-help">
              游标 {view.cursor} · 授权模块{" "}
              {view.scope.modules.join(", ") || "无"}
            </p>
            {view.records.map((record) => (
              <details className="projection-record" key={record.id}>
                <summary>
                  {record.title || record.id} · {record.module} / {record.type}{" "}
                  · v{record.version}
                  {record.deleted ? " · 已删除" : ""}
                </summary>
                <p className="source-id">记录 ID：{record.id}</p>
                <p className="form-help">
                  {record.kind} · {record.status} ·{" "}
                  {record.occurredAt || "发生时间未授权"} ·{" "}
                  {record.timeZone || "时区未授权"}
                </p>
                <StructuredResult value={record.fields} />
                {record.body && (
                  <p className="projection-body">{record.body}</p>
                )}
                {record.relations.length > 0 && (
                  <StructuredResult value={record.relations} />
                )}
              </details>
            ))}
          </article>
        ))
      )}
    </section>
  );
}
