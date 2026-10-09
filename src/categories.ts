import type { Module } from "./types.js";

/** Public classification contains no personal goals, modules or execution grants. */
export const CATEGORY_REGISTRY = [
  { id: "planning", label: "生活规划" },
  { id: "health", label: "运动健康" },
  { id: "learning", label: "阅读学习" },
  { id: "projects", label: "项目实践" },
  { id: "language", label: "语言" },
  { id: "research", label: "研究" },
  { id: "finance", label: "资产财务" },
  { id: "family", label: "亲属关系" },
] as const;
export type CategoryId = (typeof CATEGORY_REGISTRY)[number]["id"];
const defaults: Record<string, CategoryId> = {
  planning: "planning",
  health: "health",
  learning: "learning",
  projects: "projects",
  languages: "language",
  quant: "research",
  finance: "finance",
  family: "family",
};
export function isCategoryId(value: string): value is CategoryId {
  return CATEGORY_REGISTRY.some((category) => category.id === value);
}
export function moduleCategory(id: string): CategoryId | undefined {
  return Object.hasOwn(defaults, id) ? defaults[id] : undefined;
}
export type CategoryResponse = {
  categories: { id: CategoryId; label: string; moduleIds: string[] }[];
  unassignedModuleIds: string[];
};
export function classifyModules(
  modules: readonly Module[],
  navigation: {
    order: string[];
    labels: Record<string, string>;
    moduleCategories: Record<string, string>;
  },
): CategoryResponse {
  const order = [...navigation.order, ...CATEGORY_REGISTRY.map((c) => c.id)];
  const ids = [...new Set(order)];
  const category = (id: string) =>
    Object.hasOwn(navigation.moduleCategories, id)
      ? navigation.moduleCategories[id]
      : moduleCategory(id);
  return {
    categories: ids.map((id) => {
      const item = CATEGORY_REGISTRY.find((c) => c.id === id)!;
      return {
        ...item,
        label: navigation.labels[id] ?? item.label,
        moduleIds: modules
          .filter((m) => category(m.id) === id)
          .map((m) => m.id),
      };
    }),
    unassignedModuleIds: modules
      .filter((m) => !category(m.id))
      .map((m) => m.id),
  };
}
