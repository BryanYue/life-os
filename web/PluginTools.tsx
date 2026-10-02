import React, { useState } from "react";
import type { PluginInstallation } from "../src/plugins.js";
import type { EntityInput, SaveRequest } from "../src/types.js";
import { StructuredResult, type LocalToolProps } from "./SyncTools.js";
const stateLabels = {
  installed: "已安装，待授权",
  enabled: "已启用",
  disabled: "已禁用",
  uninstalled: "已卸载，数据保留",
};
const actionLabels = {
  read: "读取",
  suggest: "生成推断",
  write: "写入",
  external: "外部操作（当前禁止）",
};
type ToolProps = LocalToolProps & {
  plugin: PluginInstallation;
  reload: () => Promise<void>;
};
function PluginCard({ plugin, reload, ...props }: ToolProps) {
  const contract = plugin.manifest.module.contract;
  const [grants, setGrants] = useState<string[]>(plugin.grants);
  const [trust, setTrust] = useState(plugin.trustedLocalCode);
  const [network, setNetwork] = useState(plugin.acknowledgeUnsandboxedNetwork);
  const [operationId, setOperationId] = useState(
    contract.operations[0]?.id ?? "",
  );
  const [input, setInput] = useState("");
  const [recordMode, setRecordMode] = useState(false);
  const [typeId, setTypeId] = useState(
    plugin.manifest.module.entityTypes[0]?.id ?? "",
  );
  const [title, setTitle] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [timeZone, setTimeZone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [fields, setFields] = useState<Record<string, string>>({});
  const [importerId, setImporterId] = useState(contract.importers[0]?.id ?? "");
  const [importText, setImportText] = useState("");
  const [output, setOutput] = useState<{
    label: string;
    value: unknown;
  } | null>(null);
  const operation = contract.operations.find((item) => item.id === operationId);
  const entityType = plugin.manifest.module.entityTypes.find(
    (item) => item.id === typeId,
  );
  const missing =
    operation?.permissions.filter((id) => !plugin.grants.includes(id)) ?? [];
  const recordPermission = contract.permissions.find(
    (permission) =>
      operation?.permissions.includes(permission.id) &&
      permission.action === operation.handler,
  );
  const recordFields =
    entityType?.fields.filter(
      (field) =>
        !recordPermission?.fields ||
        recordPermission.fields.includes(field.key),
    ) ?? [];
  async function mutate(path: string, body: unknown, label: string) {
    await props.run(async () => {
      try {
        const value = await props.request(path, body);
        setOutput({ label, value });
        await props.onImported();
      } finally {
        await reload();
      }
    });
  }
  function recordInput(): SaveRequest {
    if (!title.trim() || !occurredAt || !entityType)
      throw Error("请填写记录标题、发生时间和记录类型。");
    if (
      !/(?:Z|[+-]\d{2}:\d{2})$/.test(occurredAt) ||
      !Number.isFinite(Date.parse(occurredAt))
    )
      throw Error("请填写包含Z或明确时差的ISO发生时间。");
    const entityFields: EntityInput["fields"] = {};
    for (const field of recordFields) {
      const value = fields[field.key] ?? "";
      if (field.required && !value.trim())
        throw Error(`请填写${field.label}。`);
      if (value !== "")
        entityFields[field.key] =
          field.type === "number" ? Number(value) : value;
    }
    return {
      expectedVersion: 0,
      entity: {
        module: plugin.id,
        type: typeId,
        title: title.trim(),
        kind: operation?.handler === "suggest" ? "inference" : "fact",
        status: operation?.handler === "suggest" ? "draft" : "done",
        occurredAt: new Date(occurredAt).toISOString(),
        timeZone,
        fields: entityFields,
        relations: [],
        body: "",
      },
    };
  }
  return (
    <article className="plugin-card" aria-label={`插件 ${plugin.id}`}>
      <div className="section-heading">
        <div>
          <h3>{plugin.manifest.module.name}</h3>
          <p>
            {plugin.id} · v{plugin.manifest.module.version} · schema{" "}
            {plugin.manifest.module.schemaVersion}
          </p>
        </div>
        <span className="small-chip plugin-state">
          {stateLabels[plugin.state]}
        </span>
      </div>
      <p className="form-help">清单路径：{plugin.manifestPath}</p>
      {plugin.entryPath && (
        <p className="form-help">本地代码：{plugin.entryPath}</p>
      )}
      {plugin.lastError && (
        <p className="report-warning">最近失败：{plugin.lastError}</p>
      )}
      {plugin.state !== "uninstalled" && (
        <>
          <details className="plugin-authorize">
            <summary>权限授权与本地代码信任</summary>
            <p className="form-help">
              仅选择你实际允许的权限。提交授权会先禁用插件，需再启用；升级后需要重新授权。
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void mutate(
                  `/api/plugins/${encodeURIComponent(plugin.id)}/authorize`,
                  {
                    permissions: grants,
                    trustLocalCode: trust,
                    acknowledgeUnsandboxedNetwork: network,
                  },
                  "授权结果",
                );
              }}
            >
              <div className="permission-list">
                {contract.permissions.map((permission) => (
                  <label className="permission-row" key={permission.id}>
                    <input
                      type="checkbox"
                      aria-label={`授权 ${permission.id}`}
                      disabled={permission.action === "external" || props.busy}
                      checked={grants.includes(permission.id)}
                      onChange={(event) =>
                        setGrants(
                          event.target.checked
                            ? [...grants, permission.id]
                            : grants.filter((id) => id !== permission.id),
                        )
                      }
                    />
                    <span>
                      <strong>
                        {permission.id} · {actionLabels[permission.action]}
                      </strong>
                      <small>
                        模块 {permission.module} · 类型{" "}
                        {permission.entityTypes?.join(", ") ?? "全部"} · 字段{" "}
                        {permission.fields?.join(", ") ?? "全部"}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              {plugin.entryPath && (
                <div className="report-warning">
                  <p>
                    仅运行你信任的本地代码。Node
                    权限限制部分文件、进程、线程与扩展能力，但不是恶意代码沙箱，直接网络和系统调用没有隔离；不可信代码需先使用操作系统隔离。
                  </p>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={trust}
                      onChange={(event) => setTrust(event.target.checked)}
                    />
                    我已审阅并信任此插件的本地代码
                  </label>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={network}
                      onChange={(event) => setNetwork(event.target.checked)}
                    />
                    我理解网络和系统调用未隔离的风险
                  </label>
                </div>
              )}
              <button
                className="button"
                disabled={props.busy || (trust && !network)}
              >
                保存明确授权
              </button>
            </form>
          </details>
          <div className="settings-actions">
            <button
              className="button"
              disabled={
                props.busy || plugin.state === "enabled" || !plugin.authorized
              }
              onClick={() =>
                void mutate(
                  `/api/plugins/${encodeURIComponent(plugin.id)}/enable`,
                  {},
                  "启用结果",
                )
              }
            >
              启用插件
            </button>
            <button
              className="button"
              disabled={props.busy || plugin.state === "disabled"}
              onClick={() =>
                void mutate(
                  `/api/plugins/${encodeURIComponent(plugin.id)}/disable`,
                  {},
                  "禁用结果",
                )
              }
            >
              禁用插件
            </button>
            <button
              className="button"
              disabled={props.busy}
              onClick={() =>
                void mutate(
                  `/api/plugins/${encodeURIComponent(plugin.id)}/uninstall`,
                  {},
                  "卸载结果（数据保留）",
                )
              }
            >
              卸载并保留数据
            </button>
          </div>
          <details className="manual-import">
            <summary>调用操作与手动导入</summary>
            <p className="form-help">
              调用受当前权限约束，外部执行始终禁止。本地代码操作仅在双确认授权后可运行。
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void props.run(async () => {
                  const payload: unknown = recordMode
                    ? recordInput()
                    : input.trim()
                      ? JSON.parse(input)
                      : {};
                  try {
                    const value = await props.request(
                      `/api/plugins/${encodeURIComponent(plugin.id)}/invoke/${encodeURIComponent(operationId)}`,
                      { input: payload },
                    );
                    setOutput({ label: `操作 ${operationId}`, value });
                    await props.onImported();
                  } finally {
                    await reload();
                  }
                });
              }}
            >
              <label className="form-field">
                插件操作
                <select
                  aria-label="插件操作"
                  value={operationId}
                  onChange={(event) => {
                    const selected = contract.operations.find(
                      (item) => item.id === event.target.value,
                    );
                    setOperationId(event.target.value);
                    setRecordMode(
                      selected?.handler === "suggest" ||
                        selected?.handler === "write",
                    );
                    setOutput(null);
                  }}
                >
                  {contract.operations.map((item) => (
                    <option
                      key={item.id}
                      value={item.id}
                      disabled={item.handler === "external"}
                    >
                      {item.id} · {item.handler}
                    </option>
                  ))}
                </select>
              </label>
              <p className="form-help">
                需要权限：{operation?.permissions.join(", ") || "无"}
                {missing.length ? ` · 尚未授权：${missing.join(", ")}` : ""}
              </p>
              {operation?.handler === "stdio" && !plugin.trustedLocalCode && (
                <p className="report-warning">
                  此操作需要上方两项代码信任与网络风险确认，然后保存授权。
                </p>
              )}
              {operation &&
                ["suggest", "write"].includes(operation.handler) && (
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={recordMode}
                      onChange={(event) => setRecordMode(event.target.checked)}
                    />
                    通过表单创建
                    {operation.handler === "suggest" ? "草稿推断" : "事实记录"}
                  </label>
                )}
              {recordMode ? (
                <div className="form-grid">
                  <label className="form-field">
                    插件记录标题
                    <input
                      required
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    插件记录类型
                    <select
                      aria-label="插件记录类型"
                      value={typeId}
                      onChange={(event) => {
                        setTypeId(event.target.value);
                        setFields({});
                      }}
                    >
                      {plugin.manifest.module.entityTypes.map((type) => (
                        <option value={type.id} key={type.id}>
                          {type.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field">
                    插件记录发生时间（带时差 ISO）
                    <input
                      type="text"
                      placeholder="例如 2030-04-01T09:00:00+08:00"
                      required
                      value={occurredAt}
                      onChange={(event) => setOccurredAt(event.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    插件记录时区
                    <input
                      required
                      value={timeZone}
                      onChange={(event) => setTimeZone(event.target.value)}
                    />
                  </label>
                  {recordFields.map((field) => (
                    <label className="form-field" key={field.key}>
                      {field.label}
                      {field.type === "select" ? (
                        <select
                          required={field.required}
                          value={fields[field.key] ?? ""}
                          onChange={(event) =>
                            setFields({
                              ...fields,
                              [field.key]: event.target.value,
                            })
                          }
                        >
                          <option value="">请选择</option>
                          {field.options?.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={
                            field.type === "number"
                              ? "number"
                              : field.type === "date"
                                ? "date"
                                : "text"
                          }
                          required={field.required}
                          min={field.min}
                          value={fields[field.key] ?? ""}
                          onChange={(event) =>
                            setFields({
                              ...fields,
                              [field.key]: event.target.value,
                            })
                          }
                        />
                      )}
                    </label>
                  ))}
                </div>
              ) : (
                <label className="form-field">
                  插件操作输入 JSON
                  <textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder={
                      operation?.handler === "list"
                        ? "列表操作无需输入，可留空"
                        : operation?.handler === "patch"
                          ? '{"id":"记录ID","expectedVersion":1,"fields":{"字段名":"值"}}'
                          : "按插件操作约定填写 JSON；写入操作使用含entity和expectedVersion的SaveRequest"
                    }
                  />
                </label>
              )}
              <button
                className="button"
                disabled={
                  props.busy ||
                  plugin.state !== "enabled" ||
                  missing.length > 0 ||
                  (operation?.handler === "stdio" &&
                    (!plugin.trustedLocalCode ||
                      !plugin.acknowledgeUnsandboxedNetwork))
                }
              >
                调用插件操作
              </button>
            </form>
            {contract.importers.length > 0 && (
              <form
                className="plugin-import-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void mutate(
                    `/api/plugins/${encodeURIComponent(plugin.id)}/import/${encodeURIComponent(importerId)}`,
                    { text: importText },
                    `导入 ${importerId}`,
                  );
                }}
              >
                <label className="form-field">
                  插件导入器
                  <select
                    aria-label="插件导入器"
                    value={importerId}
                    onChange={(event) => setImporterId(event.target.value)}
                  >
                    {contract.importers.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.id} · {item.format} · 操作 {item.operation}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="button file-button">
                  选择插件导入文件
                  <input
                    type="file"
                    aria-label="选择插件导入文件"
                    disabled={props.busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file)
                        void props.run(async () =>
                          setImportText(await file.text()),
                        );
                    }}
                  />
                </label>
                <label className="form-field">
                  插件导入文字
                  <textarea
                    required
                    value={importText}
                    onChange={(event) => setImportText(event.target.value)}
                    placeholder="按上方导入器的 JSON 或文字约定填写"
                  />
                </label>
                <button
                  className="button"
                  disabled={
                    props.busy ||
                    plugin.state !== "enabled" ||
                    !importText.trim()
                  }
                >
                  运行插件导入器
                </button>
              </form>
            )}
          </details>
        </>
      )}
      {output && (
        <div className="plugin-output" role="status">
          <h4>{output.label}</h4>
          <StructuredResult value={output.value} />
        </div>
      )}
      <details>
        <summary>最近生命周期记录（{plugin.events.length}）</summary>
        <div className="report-scroll">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>动作</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              {plugin.events
                .slice(-10)
                .reverse()
                .map((event, index) => (
                  <tr key={index}>
                    <td>{event.at}</td>
                    <td>{event.action}</td>
                    <td>
                      {event.ok ? "成功" : "失败"}
                      {event.message ? ` · ${event.message}` : ""}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  );
}
export function PluginTools(props: LocalToolProps) {
  const [plugins, setPlugins] = useState<PluginInstallation[] | null>(null);
  const [path, setPath] = useState("");
  const [mode, setMode] = useState<"install" | "upgrade">("install");
  async function reload() {
    const value = await props.request<{
      plugins: PluginInstallation[];
      limitations: string;
    }>("/api/plugins");
    setPlugins(value.plugins);
  }
  return (
    <section className="panel specialist-panel" aria-label="本地插件工具">
      <div className="section-heading">
        <div>
          <h2>本地插件管理</h2>
          <p>
            从仓库和私有数据目录之外的本地路径安装清单。安装不会自动授权或启用；卸载会保留业务数据。
          </p>
        </div>
        <button
          className="button"
          disabled={props.busy}
          onClick={() => void props.run(reload)}
        >
          刷新插件列表
        </button>
      </div>
      <form
        className="report-controls"
        onSubmit={(event) => {
          event.preventDefault();
          void props.run(
            async () => {
              await props.request(`/api/plugins/${mode}`, { path });
              await reload();
              await props.onImported();
            },
            mode === "install"
              ? "本地插件已安装，请检查权限并明确授权。"
              : "本地插件已升级，需要重新授权和启用。",
          );
        }}
      >
        <label className="form-field">
          插件清单本地路径
          <input
            required
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="仓库外 manifest.json 的绝对路径"
          />
        </label>
        <label className="form-field">
          安装或升级
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as typeof mode)}
          >
            <option value="install">安装</option>
            <option value="upgrade">升级</option>
          </select>
        </label>
        <button className="button" disabled={props.busy || !path.trim()}>
          {mode === "install" ? "安装本地插件" : "升级本地插件"}
        </button>
      </form>
      <p className="form-help">
        代码执行仅限信任的本地代码。Node权限不是恶意代码沙箱，也不隔离网络和系统调用。外部交易、支付与其他
        external 操作始终禁用。
      </p>
      {plugins === null ? (
        <p className="quiet-inline">刷新列表以检查本地安装记录与权限。</p>
      ) : !plugins.length ? (
        <p className="quiet-inline">当前没有安装记录。</p>
      ) : (
        plugins.map((plugin) => (
          <PluginCard
            key={`${plugin.id}:${plugin.manifest.module.version}:${plugin.state}:${plugin.authorized}:${plugin.grants.join(",")}:${plugin.trustedLocalCode}`}
            plugin={plugin}
            {...props}
            reload={reload}
          />
        ))
      )}
    </section>
  );
}
