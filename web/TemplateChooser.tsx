import React, { useEffect, useState } from "react";
import type { Entity, Module } from "../src/types.js";
import type {
  TemplateApplyInput,
  TemplateDefinition,
  TemplateListing,
  TemplatePreview,
  TemplateScalar,
} from "../src/templates.js";
import {
  normalizeLanguage,
  type LanguageDefinition,
} from "../src/languages.js";
import type { SpecialistProps } from "./SpecialistPanels.js";
import type { PersonalProfile, ProfilePatch } from "./PersonalizationTypes.js";
import { browserNow } from "./ReadingWorkspace.js";
import {
  configuredLanguageOptions,
  LanguageSelect,
  languageNeedsUpgrade,
} from "./LanguageControls.js";
import { LocalDateTimeField } from "./LocalDateTimeField.js";

export function TemplateChooser({
  profile,
  modules,
  catalog,
  onSaveProfile,
  ...props
}: SpecialistProps & {
  profile: PersonalProfile;
  modules: Module[];
  catalog: LanguageDefinition[];
  onSaveProfile: (
    patch: ProfilePatch,
    expectedRevision: number,
  ) => Promise<void>;
}) {
  const [templates, setTemplates] = useState<TemplateListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [parameters, setParameters] = useState<Record<string, TemplateScalar>>(
    {},
  );
  const [timeZone, setTimeZone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [occurredAt, setOccurredAt] = useState(browserNow());
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [application, setApplication] = useState<TemplateApplyInput | null>(
    null,
  );
  const [applied, setApplied] = useState<Entity | null>(null);
  const [json, setJson] = useState("");
  const selected = templates.find(
    (template) => `${template.id}@${template.version}` === selectedKey,
  );
  async function load() {
    setLoading(true);
    setError("");
    try {
      const result = await props.request<{ templates: TemplateListing[] }>(
        "/api/templates",
      );
      setTemplates(result.templates);
    } catch (caught) {
      setError(
        `读取模板失败：${caught instanceof Error ? caught.message : String(caught)}`,
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [modules]);
  function invalidate() {
    setPreview(null);
    setApplication(null);
    setApplied(null);
    setError("");
  }
  function selectTemplate(template: TemplateListing) {
    setSelectedKey(`${template.id}@${template.version}`);
    const defaults = Object.fromEntries(
      template.parameters
        .filter((parameter) => parameter.default !== undefined)
        .map((parameter) => [parameter.key, parameter.default!]),
    );
    if (
      template.parameters.some(
        (parameter) =>
          parameter.key === "language" && parameter.type === "text",
      )
    ) {
      const options = configuredLanguageOptions(
        modules.find((module) => module.id === template.target.module),
        catalog,
        profile.languagePreferences.activeCodes,
      );
      defaults.language =
        options.find(
          (option) =>
            normalizeLanguage(option.value) ===
            normalizeLanguage(defaults.language),
        )?.value ??
        options[0]?.value ??
        "";
    }
    setParameters(defaults);
    invalidate();
  }
  async function setEnabled(template: TemplateListing, enabled: boolean) {
    await props.run(async () => {
      setError("");
      try {
        const enabledIds = enabled
          ? [
              ...new Set([
                ...profile.templatePreferences.enabledIds,
                template.id,
              ]),
            ]
          : profile.templatePreferences.enabledIds.filter(
              (id) => id !== template.id,
            );
        await onSaveProfile(
          { templatePreferences: { enabledIds } },
          profile.revision,
        );
        if (!enabled && selected?.id === template.id) {
          setSelectedKey("");
          invalidate();
        }
      } catch (caught) {
        setError(
          `保存模板选择失败：${caught instanceof Error ? caught.message : String(caught)}`,
        );
        throw caught;
      }
    }, "模板选择已保存。预览后明确采用才会创建计划。");
  }
  async function makePreview() {
    if (!selected) return;
    await props.run(async () => {
      setError("");
      try {
        const input = {
          templateId: selected.id,
          version: selected.version,
          parameters,
          occurredAt,
          timeZone,
        };
        const result = await props.request<TemplatePreview>(
          "/api/templates/preview",
          input,
        );
        setPreview(result);
        setApplication({ ...input, operationId: crypto.randomUUID() });
        setApplied(null);
      } catch (caught) {
        setError(
          `预览失败：${caught instanceof Error ? caught.message : String(caught)}`,
        );
        throw caught;
      }
    });
  }
  async function apply() {
    if (!application || applied) return;
    await props.run(async () => {
      setError("");
      try {
        const entity = await props.request<Entity>(
          "/api/templates/apply",
          application,
        );
        setApplied(entity);
        await props.onImported();
      } catch (caught) {
        setError(
          `采用失败：${caught instanceof Error ? caught.message : String(caught)}。保留此次操作，可原样重试核对此计划。`,
        );
        throw caught;
      }
    }, "模板已明确采用为计划；学习事实和实际分钟请另行记录。");
  }
  const requiresLanguageUpgrade = selected?.parameters.some(
    (parameter) =>
      parameter.key === "language" &&
      languageNeedsUpgrade(
        String(parameters[parameter.key] ?? ""),
        modules.find((module) => module.id === selected.target.module),
      ),
  );
  const selectedEnabled =
    !!selected && profile.templatePreferences.enabledIds.includes(selected.id);
  return (
    <section className="panel template-chooser" aria-label="通用计划模板">
      <div className="section-heading">
        <div>
          <h2>选择一个起点</h2>
          <p>
            通用模板只预填计划。调整参数、检查预览，再明确采用；选择与预览均不创建记录。
          </p>
        </div>
        <button
          className="button"
          disabled={loading || props.busy}
          onClick={() => void load()}
        >
          刷新模板
        </button>
      </div>
      {loading && (
        <p className="quiet-inline" role="status">
          正在读取模板…
        </p>
      )}
      {error && (
        <div className="message error" role="alert">
          <span>{error}</span>
          <button
            className="text-button"
            disabled={props.busy}
            onClick={() =>
              void (application && !applied
                ? apply()
                : selected
                  ? makePreview()
                  : load())
            }
          >
            {application && !applied
              ? "重试采用模板"
              : selected
                ? "重试预览模板"
                : "重试读取模板"}
          </button>
        </div>
      )}
      <div className="template-grid">
        {templates.map((template) => (
          <article
            className={`template-card ${selectedKey === `${template.id}@${template.version}` ? "selected" : ""}`}
            key={`${template.id}@${template.version}`}
            data-template-id={template.id}
            data-template-version={template.version}
          >
            <label className="check-field">
              <input
                type="checkbox"
                aria-label={`选择模板 ${template.name}`}
                checked={profile.templatePreferences.enabledIds.includes(
                  template.id,
                )}
                disabled={props.busy}
                onChange={(event) =>
                  void setEnabled(template, event.target.checked)
                }
              />
              <span>
                <strong>{template.name}</strong>
                <small>
                  {template.source === "builtin"
                    ? "内置通用模板"
                    : "个人 JSON 模板"}{" "}
                  · v{template.version}
                </small>
              </span>
            </label>
            <p>{template.description}</p>
            <p className="form-help">
              需要：
              {template.requires
                .map(
                  (id) =>
                    modules.find((module) => module.id === id)?.name ?? id,
                )
                .join("、")}
            </p>
            {!template.available && (
              <p className="report-warning">
                暂不可用：{template.unavailableReason ?? "请启用所需模块"}
              </p>
            )}
            <button
              className="button"
              disabled={
                props.busy ||
                !template.available ||
                !profile.templatePreferences.enabledIds.includes(template.id)
              }
              onClick={() => selectTemplate(template)}
            >
              配置 {template.name}
            </button>
          </article>
        ))}
      </div>
      {selected && selectedEnabled && (
        <div className="template-workspace">
          <h3>{selected.name} · 参数与预览</h3>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void makePreview();
            }}
          >
            <div className="form-grid">
              {selected.parameters.map((parameter) => (
                <label className="form-field" key={parameter.key}>
                  {parameter.label}
                  {parameter.required ? " *" : ""}
                  {parameter.key === "language" && parameter.type === "text" ? (
                    <LanguageSelect
                      label={`模板参数 ${parameter.label}`}
                      module={modules.find(
                        (module) => module.id === selected.target.module,
                      )}
                      profile={profile}
                      catalog={catalog}
                      required={parameter.required}
                      value={String(parameters[parameter.key] ?? "")}
                      onChange={(value) => {
                        setParameters((previous) => ({
                          ...previous,
                          [parameter.key]: value,
                        }));
                        invalidate();
                      }}
                    />
                  ) : parameter.type === "select" ? (
                    <select
                      aria-label={`模板参数 ${parameter.label}`}
                      required={parameter.required}
                      value={parameters[parameter.key] ?? ""}
                      onChange={(event) => {
                        setParameters((previous) => ({
                          ...previous,
                          [parameter.key]: event.target.value,
                        }));
                        invalidate();
                      }}
                    >
                      <option value="">请选择</option>
                      {parameter.options?.map((value) => (
                        <option value={value} key={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      aria-label={`模板参数 ${parameter.label}`}
                      type={parameter.type === "number" ? "number" : "text"}
                      min={parameter.min}
                      max={parameter.max}
                      step={parameter.type === "number" ? "any" : undefined}
                      required={parameter.required}
                      value={parameters[parameter.key] ?? ""}
                      onChange={(event) => {
                        const value = event.target.value;
                        setParameters((previous) => {
                          const next = { ...previous };
                          if (!value && parameter.type === "number")
                            delete next[parameter.key];
                          else
                            next[parameter.key] =
                              parameter.type === "number"
                                ? Number(value)
                                : value;
                          return next;
                        });
                        invalidate();
                      }}
                    />
                  )}
                </label>
              ))}
              <LocalDateTimeField
                label="模板计划时间"
                required
                value={occurredAt}
                timeZone={timeZone}
                onChange={(value) => {
                  setOccurredAt(value);
                  invalidate();
                }}
              />
              <label className="form-field">
                模板时区
                <input
                  aria-label="模板时区"
                  value={timeZone}
                  onChange={(event) => {
                    setTimeZone(event.target.value);
                    invalidate();
                  }}
                  required
                />
              </label>
            </div>
            {requiresLanguageUpgrade && (
              <p className="report-warning">
                此语言需要先在个人设置中明确升级相关模块到 Schema 3。
              </p>
            )}
            <button
              className="button"
              disabled={
                props.busy || !selected.available || requiresLanguageUpgrade
              }
            >
              预览模板计划
            </button>
          </form>
          {preview && (
            <article className="template-preview" aria-label="模板计划预览">
              <div className="section-heading">
                <h3>{preview.entity.title}</h3>
                <span className="kind-badge plan">
                  计划 · {preview.entity.status === "draft" ? "草稿" : "进行中"}
                </span>
              </div>
              <p>
                {modules.find((module) => module.id === preview.entity.module)
                  ?.name ?? preview.entity.module}{" "}
                · {preview.entity.type}
              </p>
              <pre>{preview.entity.body || "（无正文）"}</pre>
              <details>
                <summary>检查字段、关联与时间</summary>
                <pre>
                  {JSON.stringify(
                    {
                      fields: preview.entity.fields,
                      relations: preview.entity.relations,
                      occurredAt: preview.entity.occurredAt,
                      timeZone: preview.entity.timeZone,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
              <p className="form-help">
                采用后只保存以上计划。此操作尚未记录完成、阅读分钟或任何成果。
              </p>
              <button
                className="button primary"
                disabled={props.busy || !!applied || !selected.available}
                onClick={() => void apply()}
              >
                {applied ? "✓ 已采用模板" : "明确采用为计划"}
              </button>
              {applied && (
                <button
                  className="text-button"
                  onClick={() => props.onOpen(applied.id)}
                >
                  查看已采用的计划
                </button>
              )}
            </article>
          )}
        </div>
      )}
      <details className="template-import">
        <summary>导入个人 JSON 模板</summary>
        <p className="form-help">
          粘贴声明式模板 JSON
          或选择文件。仅接收参数和计划默认值，校验失败会保留原文供修改。
        </p>
        <label className="form-field">
          个人模板 JSON
          <textarea
            aria-label="个人模板 JSON"
            value={json}
            onChange={(event) => setJson(event.target.value)}
            rows={8}
          />
        </label>
        <div className="settings-actions">
          <label className="button file-button">
            读取模板 JSON 文件
            <input
              type="file"
              accept="application/json,.json"
              aria-label="读取模板 JSON 文件"
              disabled={props.busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file)
                  void props.run(async () => {
                    if (file.size > 500000)
                      throw Error("模板文件过大，最多 500 KB。");
                    setJson(await file.text());
                  });
              }}
            />
          </label>
          <button
            className="button"
            disabled={props.busy || !json.trim()}
            onClick={() =>
              void props.run(async () => {
                setError("");
                try {
                  const template: unknown = JSON.parse(json);
                  await props.request<TemplateDefinition>(
                    "/api/templates/register",
                    { template },
                  );
                  await load();
                } catch (caught) {
                  setError(
                    `导入模板失败：${caught instanceof Error ? caught.message : String(caught)}`,
                  );
                  throw caught;
                }
              }, "个人模板已校验并登记；选择、预览和明确采用后才会创建计划。")
            }
          >
            校验并登记模板
          </button>
        </div>
      </details>
    </section>
  );
}
