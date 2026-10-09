import React, { useEffect, useState } from "react";
import type { Module } from "../src/types.js";
import {
  languageCatalog,
  normalizeLanguage,
  type LanguageDefinition,
} from "../src/languages.js";
import type { SpecialistProps } from "./SpecialistPanels.js";
import type {
  CategoryRegistry,
  LanguageSettings,
  PersonalProfile,
  ProfilePatch,
} from "./PersonalizationTypes.js";

export function PersonalizationSettings({
  profile,
  registry,
  languages,
  modules,
  onSaveProfile,
  onBrowseHistory,
  ...props
}: SpecialistProps & {
  profile: PersonalProfile;
  registry: CategoryRegistry;
  languages: LanguageSettings;
  modules: Module[];
  onSaveProfile: (
    patch: ProfilePatch,
    expectedRevision: number,
  ) => Promise<void>;
  onBrowseHistory: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(profile);
  const [dirty, setDirty] = useState(false);
  const [localError, setLocalError] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [upgrades, setUpgrades] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!dirty) setDraft(profile);
  }, [profile, dirty]);
  function change(patch: Partial<PersonalProfile>) {
    setDraft((previous) => ({ ...previous, ...patch }));
    setDirty(true);
    setLocalError("");
  }
  let catalog: LanguageDefinition[] = languages.catalog;
  try {
    catalog = languageCatalog(draft.languagePreferences.customLanguages ?? []);
  } catch {
    // The server's verified catalog remains usable while a draft is being corrected.
  }
  const categoryIds = [
    ...draft.navigation.order,
    ...registry.categories.map((category) => category.id),
  ].filter((id, index, list) => list.indexOf(id) === index);
  const categories = categoryIds
    .map((id) => registry.categories.find((category) => category.id === id))
    .filter((category) => category !== undefined);
  function moveCategory(id: string, direction: -1 | 1) {
    const order = categories.map((category) => category.id);
    const index = order.indexOf(id),
      next = index + direction;
    if (next < 0 || next >= order.length) return;
    [order[index], order[next]] = [order[next], order[index]];
    change({ navigation: { ...draft.navigation, order } });
  }
  function addLanguage(event: React.FormEvent) {
    event.preventDefault();
    try {
      const normalized = normalizeLanguage(code);
      if (!normalized || !name.trim())
        throw Error("请填写有效语言代码和显示名称，例如 ko 与韩语。");
      const customLanguages = [
        ...(draft.languagePreferences.customLanguages ?? []),
        { code: normalized, name: name.trim() },
      ];
      languageCatalog(customLanguages);
      change({
        languagePreferences: {
          ...draft.languagePreferences,
          customLanguages,
          activeCodes: [...draft.languagePreferences.activeCodes, normalized],
        },
      });
      setCode("");
      setName("");
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : String(caught));
    }
  }
  async function savePreferences() {
    await props.run(async () => {
      setLocalError("");
      try {
        await onSaveProfile(
          {
            languagePreferences: draft.languagePreferences,
            navigation: draft.navigation,
            history: draft.history,
          },
          draft.revision,
        );
        setDirty(false);
      } catch (caught) {
        setLocalError(
          caught instanceof Error ? caught.message : String(caught),
        );
        throw caught;
      }
    }, "个人设置已保存；目标、历史记录和语言结构由各自的明确操作管理。");
  }
  return (
    <section
      className="panel personalization-settings"
      aria-label="个人空间设置"
    >
      <div className="section-heading">
        <div>
          <h2>选择自己的空间</h2>
          <p>
            先选模块、语言和导航，再按需采用模板。选择本身不会创建目标或事实。
          </p>
        </div>
        <span className="small-chip">设置版本 {profile.revision}</span>
      </div>
      {localError && (
        <div className="message error" role="alert">
          {localError}
          <span> 已保留未保存的选择。</span>
        </div>
      )}
      {dirty && profile.revision !== draft.revision && (
        <div className="message error" role="alert">
          <span>
            保存版本已从 {draft.revision} 更新到 {profile.revision}
            。请核对当前已保存设置，再决定保留本页选择或重新读取。
          </span>
          <details>
            <summary>核对当前已保存设置</summary>
            <pre>
              {JSON.stringify(
                {
                  languagePreferences: profile.languagePreferences,
                  navigation: profile.navigation,
                  history: profile.history,
                },
                null,
                2,
              )}
            </pre>
          </details>
          <button
            className="button"
            disabled={props.busy}
            onClick={() => {
              setDraft((previous) => ({
                ...previous,
                revision: profile.revision,
              }));
              setLocalError("");
            }}
          >
            保留选择并使用此版本
          </button>
          <button
            className="button"
            disabled={props.busy}
            onClick={() => {
              setDraft(profile);
              setDirty(false);
              setLocalError("");
            }}
          >
            放弃草稿并重新读取
          </button>
        </div>
      )}
      <div className="personalization-grid">
        <section className="settings-section">
          <h3>启用哪些模块</h3>
          <p className="form-help">
            模块开关即时生效。停用保留记录、笔记与关联；重新启用后可继续使用。存在依赖时，先处理依赖模块。
          </p>
          <div className="module-settings-list">
            {modules.map((module) => (
              <article
                className="module-setting"
                key={module.id}
                data-module-id={module.id}
              >
                <div>
                  <strong>{module.name}</strong>
                  <small>
                    {module.enabled ? "已启用" : "已停用 · 历史保留"} · Schema{" "}
                    {module.schemaVersion}
                  </small>
                  {!!module.contract?.dependencies?.length && (
                    <small>
                      依赖：
                      {module.contract.dependencies
                        .map(
                          (dependency) =>
                            modules.find(
                              (item) => item.id === dependency.module,
                            )?.name ?? dependency.module,
                        )
                        .join("、")}
                    </small>
                  )}
                </div>
                <button
                  className="button"
                  disabled={props.busy}
                  aria-label={`${module.enabled ? "停用" : "启用"} ${module.name}`}
                  onClick={() =>
                    void props.run(
                      async () => {
                        await props.request(
                          `/api/modules/${encodeURIComponent(module.id)}/enabled`,
                          { enabled: !module.enabled },
                        );
                        await props.onImported();
                      },
                      module.enabled
                        ? `${module.name} 已停用，所有历史记录仍保留。`
                        : `${module.name} 已启用。`,
                    )
                  }
                >
                  {module.enabled ? "停用" : "启用"}
                </button>
              </article>
            ))}
          </div>
          <label className="check-field history-preference">
            <input
              type="checkbox"
              aria-label="默认浏览停用模块历史"
              checked={draft.history.includeDisabled}
              onChange={(event) =>
                change({ history: { includeDisabled: event.target.checked } })
              }
            />
            <span>
              默认浏览停用模块历史
              <small>在总览和分类中显示只读历史；不恢复模块操作。</small>
            </span>
          </label>
          <button
            className="text-button"
            disabled={props.busy}
            onClick={() => void props.run(onBrowseHistory)}
          >
            现在浏览停用模块历史
          </button>
        </section>
        <section className="settings-section">
          <h3>学习哪些语言</h3>
          <p className="form-help">
            语言代码用于识别语言，显示名称可由个人配置补充。取消学习保留原有语言记录。
          </p>
          <div className="language-checks">
            {catalog.map((language) => (
              <label className="check-field" key={language.code}>
                <input
                  type="checkbox"
                  aria-label={`学习 ${language.name}`}
                  checked={draft.languagePreferences.activeCodes.includes(
                    language.code,
                  )}
                  onChange={(event) =>
                    change({
                      languagePreferences: {
                        ...draft.languagePreferences,
                        activeCodes: event.target.checked
                          ? [
                              ...draft.languagePreferences.activeCodes,
                              language.code,
                            ]
                          : draft.languagePreferences.activeCodes.filter(
                              (item) => item !== language.code,
                            ),
                      },
                    })
                  }
                />
                <span>
                  {language.name}
                  <small>{language.code}</small>
                </span>
              </label>
            ))}
          </div>
          <form className="custom-language-form" onSubmit={addLanguage}>
            <div className="form-grid">
              <label className="form-field">
                语言代码
                <input
                  aria-label="自定义语言代码"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="例如 ko"
                  maxLength={100}
                />
              </label>
              <label className="form-field">
                显示名称
                <input
                  aria-label="自定义语言名称"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如 韩语"
                  maxLength={100}
                />
              </label>
            </div>
            <button
              className="button"
              disabled={props.busy || !code.trim() || !name.trim()}
            >
              加入语言选择
            </button>
          </form>
          <div className="language-upgrades" aria-label="扩展语言结构升级">
            <h4>扩展语言结构</h4>
            <p className="form-help">
              保存语言选择不会迁移数据。新语言需要相关模块明确升级到 Schema
              3；已有字段、记录和分钟保持原值。
            </p>
            {dirty && (
              <p className="form-help">
                请先保存个人设置，再使用新语言或执行升级。
              </p>
            )}
            {languages.pending.map((upgrade) => (
              <article className="upgrade-card" key={upgrade.module}>
                <strong>
                  {upgrade.name} · Schema {upgrade.fromSchema} →{" "}
                  {upgrade.toSchema}
                </strong>
                {upgrade.reason && (
                  <p className="form-help">{upgrade.reason}</p>
                )}
                <button
                  className="button"
                  disabled={props.busy || dirty || !upgrade.compatible}
                  aria-label={`明确升级扩展语言 ${upgrade.name}`}
                  onClick={() =>
                    void props.run(async () => {
                      const result = await props.request<{
                        fromSchema: number;
                        toSchema: number;
                        alreadyCurrent: boolean;
                        backup?: string;
                      }>("/api/languages/upgrade", { module: upgrade.module });
                      setUpgrades((previous) => ({
                        ...previous,
                        [upgrade.module]: result.alreadyCurrent
                          ? "已经是当前结构"
                          : `已升级 ${result.fromSchema} → ${result.toSchema}${result.backup ? ` · 备份：${result.backup}` : ""}`,
                      }));
                      await props.onImported();
                    }, "扩展语言结构已明确升级，历史字段保持原值。")
                  }
                >
                  明确升级 {upgrade.name}
                </button>
              </article>
            ))}
            {!languages.pending.length && (
              <p className="quiet-inline">相关内置模块已支持扩展语言。</p>
            )}
            {Object.entries(upgrades).map(([id, result]) => (
              <p className="form-help" key={id}>
                {modules.find((module) => module.id === id)?.name ?? id}：
                {result}
              </p>
            ))}
          </div>
        </section>
        <section className="settings-section category-settings">
          <h3>通用分类与导航</h3>
          <p className="form-help">
            八个分类独立于模块。可以调整显示名称、顺序和模块归属；不会修改记录所属模块。
          </p>
          {categories.map((category, index) => (
            <div className="category-setting" key={category.id}>
              <label className="form-field">
                {category.label}
                <input
                  aria-label={`分类显示名称 ${category.id}`}
                  value={draft.navigation.labels[category.id] ?? category.label}
                  maxLength={100}
                  onChange={(event) =>
                    change({
                      navigation: {
                        ...draft.navigation,
                        labels: {
                          ...draft.navigation.labels,
                          [category.id]: event.target.value,
                        },
                      },
                    })
                  }
                />
              </label>
              <div className="category-order-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`上移分类 ${category.id}`}
                  disabled={index === 0}
                  onClick={() => moveCategory(category.id, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`下移分类 ${category.id}`}
                  disabled={index === categories.length - 1}
                  onClick={() => moveCategory(category.id, 1)}
                >
                  ↓
                </button>
              </div>
            </div>
          ))}
          {modules.map((module) => (
            <label className="form-field" key={module.id}>
              {module.name} 的分类
              <select
                aria-label={`模块分类 ${module.id}`}
                value={
                  draft.navigation.moduleCategories[module.id] ??
                  registry.categories.find((category) =>
                    category.moduleIds.includes(module.id),
                  )?.id ??
                  ""
                }
                onChange={(event) =>
                  change({
                    navigation: {
                      ...draft.navigation,
                      moduleCategories: {
                        ...draft.navigation.moduleCategories,
                        [module.id]: event.target.value,
                      },
                    },
                  })
                }
              >
                <option value="" disabled>
                  未分类 · 可选择归属
                </option>
                {categories.map((category) => (
                  <option value={category.id} key={category.id}>
                    {draft.navigation.labels[category.id] || category.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </section>
      </div>
      <div className="settings-actions personalization-save">
        <button
          className="button primary"
          disabled={props.busy || !dirty}
          onClick={() => void savePreferences()}
        >
          保存个人设置
        </button>
        <button
          className="button"
          disabled={props.busy}
          onClick={() =>
            void props.run(async () => {
              setLocalError("");
              await props.onImported();
            }, "已刷新保存的个人设置；未保存选择仍保留。")
          }
        >
          刷新个人设置
        </button>
        {dirty && (
          <span className="form-help">有未保存的选择；刷新页面前请保存。</span>
        )}
      </div>
    </section>
  );
}
