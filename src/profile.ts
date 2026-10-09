import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { outsideRepository } from "./paths.js";
import {
  CATEGORY_REGISTRY,
  classifyModules,
  isCategoryId,
} from "./categories.js";
import {
  LANGUAGE_CATALOG,
  languageCatalog,
  normalizeLanguage,
  validateActiveLanguageCodes,
  validateLanguageCatalog,
} from "./languages.js";
import type { CategoryResponse } from "./categories.js";
import type { PluginManager } from "./plugins.js";
import type { Store } from "./store.js";

export type PersonalProfile = {
  profileVersion: 1;
  revision: number;
  /** Informational snapshot only: SQLite remains the activation authority. */
  modules: Record<string, boolean>;
  languagePreferences: {
    activeCodes: string[];
    customLanguages?: { code: string; name: string }[];
  };
  navigation: {
    order: string[];
    labels: Record<string, string>;
    moduleCategories: Record<string, string>;
  };
  templatePreferences: { enabledIds: string[] };
  history: { includeDisabled: boolean };
};
export type ProfileUpdate = {
  profileVersion?: 1;
  modules?: Record<string, boolean>;
  languagePreferences?: Partial<PersonalProfile["languagePreferences"]>;
  navigation?: Partial<PersonalProfile["navigation"]>;
  templatePreferences?: Partial<PersonalProfile["templatePreferences"]>;
  history?: Partial<PersonalProfile["history"]>;
};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
function keys(value: unknown, allowed: readonly string[], label: string) {
  if (
    !object(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw Error("Invalid " + label);
}
function strings(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 1000 ||
    value.some(
      (item) => typeof item !== "string" || !item.trim() || item.length > 200,
    ) ||
    new Set(value).size !== value.length
  )
    throw Error("Invalid " + label);
  return value;
}
export class ProfileManager {
  readonly path: string;
  constructor(
    private store: Store,
    private plugins?: PluginManager,
    options: { path?: string } = {},
  ) {
    this.path = outsideRepository(
      options.path ?? join(store.root, "personal-profile.json"),
    );
    // GET never creates a profile file or its directory.
  }
  private modules() {
    return Object.fromEntries(
      this.store.modules().map((m) => [m.id, m.enabled]),
    );
  }
  private defaults(): PersonalProfile {
    const offered = this.store
      .modules()
      .filter((m) => ["learning", "languages"].includes(m.id))
      .flatMap((m) =>
        m.entityTypes.flatMap((t) =>
          t.fields
            .filter((f) => f.key === "language")
            .flatMap((f) => f.options ?? []),
        ),
      )
      .map(normalizeLanguage)
      .filter((code): code is string => code !== null);
    const activeCodes = [
      ...new Set(
        offered.length ? offered : LANGUAGE_CATALOG.map((l) => l.code),
      ),
    ];
    return {
      profileVersion: 1,
      revision: 0,
      modules: this.modules(),
      languagePreferences: { activeCodes },
      navigation: {
        order: CATEGORY_REGISTRY.map((c) => c.id),
        labels: {},
        moduleCategories: {},
      },
      templatePreferences: { enabledIds: [] },
      history: { includeDisabled: false },
    };
  }
  private validate(value: unknown): PersonalProfile {
    keys(
      value,
      [
        "profileVersion",
        "revision",
        "modules",
        "languagePreferences",
        "navigation",
        "templatePreferences",
        "history",
      ],
      "personal profile",
    );
    const p = value as PersonalProfile;
    if (
      p.profileVersion !== 1 ||
      !Number.isSafeInteger(p.revision) ||
      p.revision < 0
    )
      throw Error("Unsupported profile version or revision");
    const modules = this.modules();
    if (
      !object(p.modules) ||
      Object.entries(p.modules).some(
        ([id, enabled]) =>
          !Object.hasOwn(modules, id) || typeof enabled !== "boolean",
      )
    )
      throw Error("Invalid or unknown profile module");
    keys(
      p.languagePreferences,
      ["activeCodes", "customLanguages"],
      "language preferences",
    );
    const activeCodes = validateActiveLanguageCodes(
      p.languagePreferences.activeCodes,
    );
    const custom = p.languagePreferences.customLanguages;
    if (custom !== undefined) {
      if (
        !Array.isArray(custom) ||
        custom.some(
          (item) =>
            !object(item) ||
            Object.keys(item).some((key) => !["code", "name"].includes(key)),
        )
      )
        throw Error("Invalid custom languages");
      languageCatalog(validateLanguageCatalog(custom));
    }
    keys(
      p.navigation,
      ["order", "labels", "moduleCategories"],
      "navigation preferences",
    );
    if (
      strings(p.navigation.order, "navigation order").some(
        (id) => !isCategoryId(id),
      )
    )
      throw Error("Unknown navigation category");
    if (
      !object(p.navigation.labels) ||
      Object.entries(p.navigation.labels).some(
        ([id, label]) =>
          !isCategoryId(id) ||
          typeof label !== "string" ||
          !label.trim() ||
          label.length > 100,
      )
    )
      throw Error("Invalid navigation label");
    if (
      !object(p.navigation.moduleCategories) ||
      Object.entries(p.navigation.moduleCategories).some(
        ([id, category]) =>
          !Object.hasOwn(modules, id) ||
          typeof category !== "string" ||
          !isCategoryId(category),
      )
    )
      throw Error("Invalid module category");
    keys(p.templatePreferences, ["enabledIds"], "template preferences");
    strings(p.templatePreferences.enabledIds, "template ids");
    keys(p.history, ["includeDisabled"], "history preferences");
    if (typeof p.history.includeDisabled !== "boolean")
      throw Error("Invalid history preference");
    return structuredClone({
      ...p,
      languagePreferences: {
        activeCodes,
        ...(custom !== undefined
          ? {
              customLanguages: validateLanguageCatalog(custom).map(
                ({ code, name }) => ({ code, name }),
              ),
            }
          : {}),
      },
    });
  }
  get(): PersonalProfile {
    outsideRepository(this.path);
    let stat;
    try {
      stat = lstatSync(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return this.defaults();
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
      throw Error("Invalid personal profile file");
    const profile = this.validate(JSON.parse(readFileSync(this.path, "utf8")));
    // A stale module snapshot cannot enable modules or restore execution grants.
    return { ...profile, modules: this.modules() };
  }
  update(patch: ProfileUpdate, expectedRevision: number): PersonalProfile {
    keys(
      patch,
      [
        "profileVersion",
        "modules",
        "languagePreferences",
        "navigation",
        "templatePreferences",
        "history",
      ],
      "profile update",
    );
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      throw Error("Expected profile revision required");
    if (patch.profileVersion !== undefined && patch.profileVersion !== 1)
      throw Error("Unsupported profile version");
    const parent = outsideRepository(dirname(this.path));
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    if (lstatSync(parent).isSymbolicLink())
      throw Error("Profile directory symlink denied");
    const lock = this.path + ".lock";
    try {
      mkdirSync(lock, { mode: 0o700 });
    } catch {
      throw Error(
        "Personal profile update locked; retry after current writer finishes",
      );
    }
    const temp = this.path + "." + randomUUID() + ".tmp";
    try {
      const current = this.get();
      if (current.revision !== expectedRevision)
        throw Error("Profile revision conflict");
      if (
        patch.modules !== undefined &&
        (!object(patch.modules) ||
          Object.entries(patch.modules).some(
            ([id, enabled]) =>
              !Object.hasOwn(current.modules, id) ||
              current.modules[id] !== enabled,
          ))
      )
        throw Error("Use module activation API to change enabled modules");
      for (const [key, allowed] of [
        ["languagePreferences", ["activeCodes", "customLanguages"]],
        ["navigation", ["order", "labels", "moduleCategories"]],
        ["templatePreferences", ["enabledIds"]],
        ["history", ["includeDisabled"]],
      ] as const)
        if (patch[key] !== undefined) keys(patch[key], allowed, key);
      const next = this.validate({
        ...current,
        revision: current.revision + 1,
        languagePreferences: {
          ...current.languagePreferences,
          ...patch.languagePreferences,
        },
        navigation: { ...current.navigation, ...patch.navigation },
        templatePreferences: {
          ...current.templatePreferences,
          ...patch.templatePreferences,
        },
        history: { ...current.history, ...patch.history },
      });
      const fd = openSync(temp, "wx", 0o600);
      try {
        writeFileSync(fd, JSON.stringify(next, null, 2) + "\n");
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temp, this.path);
      return { ...next, modules: this.modules() };
    } finally {
      rmSync(temp, { force: true });
      rmdirSync(lock);
    }
  }
  setModuleEnabled(id: string, enabled: boolean): PersonalProfile {
    // Validate the profile before any activation side effect, without persisting it.
    this.get();
    if (this.plugins) this.plugins.setModuleEnabled(id, enabled);
    else this.store.setEnabled(id, enabled);
    return this.get();
  }
  categories(): CategoryResponse {
    return classifyModules(this.store.modules(), this.get().navigation);
  }
}
