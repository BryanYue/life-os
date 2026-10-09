import { test as base, expect, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { app } from "../../src/server.js";
import { Store } from "../../src/store.js";
import type { Entity, EntityInput } from "../../src/types.js";
import type { TemplateDefinition } from "../../src/templates.js";
import type { PersonalProfile } from "../../src/profile.js";
import type { CategoryResponse } from "../../src/categories.js";

type IsolatedSpace = { store: Store; url: string };
const test = base.extend<{ space: IsolatedSpace }>({
  space: async ({ context }, use) => {
    const root = mkdtempSync(join(tmpdir(), "life-personalization-browser-"));
    const store = new Store(join(root, "data"));
    const server = app(store, { assets: resolve("web-dist"), port: 5174 });
    try {
      await server.listen({ host: "127.0.0.1", port: 5174 });
      await use({ store, url: "http://127.0.0.1:5174" });
    } finally {
      // Release this test's browser connections before its private HTTP server.
      await context.close();
      await server.close();
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
});
async function ready(page: Page, space: IsolatedSpace) {
  await page.goto(space.url);
  await expect(page.getByText("本地服务已连接", { exact: true })).toBeVisible();
}
async function navigate(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "展开导航", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page
    .locator(".sidebar")
    .getByRole("button", { name, exact: true })
    .click();
}
async function get<T>(
  page: Page,
  space: IsolatedSpace,
  path: string,
): Promise<T> {
  const response = await page.request.get(space.url + path);
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as T;
}
async function post<T>(
  page: Page,
  space: IsolatedSpace,
  path: string,
  data: unknown,
): Promise<T> {
  const { csrf } = await get<{ csrf: string }>(page, space, "/api/session");
  const response = await page.request.post(space.url + path, {
    headers: { "x-csrf-token": csrf },
    data,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as T;
}
async function seed(
  page: Page,
  space: IsolatedSpace,
  input: Partial<EntityInput>,
) {
  return post<Entity>(page, space, "/api/entities", {
    expectedVersion: 0,
    entity: {
      module: "learning",
      type: "goal",
      title: "虚构个人学习目标",
      kind: "plan",
      status: "active",
      occurredAt: new Date().toISOString(),
      timeZone: "UTC",
      fields: {},
      relations: [],
      body: "仅用于个人设置浏览器验证。",
      ...input,
    },
  });
}
async function openMaterialForm(page: Page, title: string) {
  const panel = page.locator(".reading-workspace");
  const details = panel.locator("details.manual-import");
  if (
    !(await details.evaluate((element) => (element as HTMLDetailsElement).open))
  )
    await details.locator(":scope > summary").click();
  await panel.getByLabel("材料标题", { exact: true }).fill(title);
  await panel
    .getByLabel("来源 URL 或引用", { exact: true })
    .fill("local:fictional-personalization");
  await panel
    .getByLabel("原文保存依据", { exact: true })
    .selectOption("本人创作");
  await panel
    .getByLabel("材料原文", { exact: true })
    .fill("这是一段为浏览器验证创作的虚构材料原文。");
  return panel;
}

test("八个独立分类：停用项目与量化保留历史和建议入口，再启用继续编辑", async ({
  page,
  space,
}) => {
  await ready(page, space);
  const project = await seed(page, space, {
    module: "projects",
    title: "虚构项目实践历史目标",
  });
  const quant = await seed(page, space, {
    module: "quant",
    title: "虚构量化历史目标",
  });
  await seed(page, space, { title: "虚构仍启用的阅读目标" });
  await ready(page, space);
  const categories = await get<CategoryResponse>(
    page,
    space,
    "/api/categories",
  );
  expect(categories.categories).toHaveLength(8);
  for (const category of categories.categories)
    await expect(
      page
        .locator(".category-navigation")
        .getByRole("button", { name: category.label, exact: true }),
    ).toBeVisible();
  await navigate(page, "数据与设置");
  const settings = page.locator(".personalization-settings");
  for (const id of ["projects", "quant"]) {
    await settings
      .locator(`[data-module-id="${id}"]`)
      .getByRole("button", { name: /^停用 / })
      .click();
    await expect(settings.locator(`[data-module-id="${id}"]`)).toContainText(
      "历史保留",
    );
  }
  expect(space.store.get(project.id)?.body).toBe(project.body);
  expect(space.store.get(quant.id)?.version).toBe(quant.version);
  await navigate(page, "生活总览");
  await expect(
    page.locator(".record-main").filter({ hasText: project.title }),
  ).toHaveCount(0);
  await expect(page.locator(".advice-panel")).toBeVisible();
  const history = page.getByLabel("浏览停用模块历史", { exact: true });
  await history.click();
  await expect(history).toBeChecked();
  await expect
    .poll(
      async () =>
        (await get<PersonalProfile>(page, space, "/api/profile")).history
          .includeDisabled,
    )
    .toBe(true);
  const row = page.locator(".record-main").filter({ hasText: project.title });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("停用模块 · 历史");
  await row.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("笔记", { exact: true })).toHaveValue(
    project.body,
  );
  await expect(dialog.getByLabel("笔记", { exact: true })).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "保存记录", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "关闭编辑", exact: true }).click();
  await navigate(page, "数据与设置");
  for (const id of ["projects", "quant"]) {
    await settings
      .locator(`[data-module-id="${id}"]`)
      .getByRole("button", { name: /^启用 / })
      .click();
    await expect(settings.locator(`[data-module-id="${id}"]`)).toContainText(
      "已启用",
    );
  }
  await navigate(page, space.store.module("projects").name);
  await page.locator(".record-main").filter({ hasText: project.title }).click();
  await expect(dialog.getByLabel("笔记", { exact: true })).toBeEnabled();
  await dialog
    .getByLabel("笔记", { exact: true })
    .fill("重新启用后明确编辑的虚构历史。");
  await dialog.getByRole("button", { name: "保存记录", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(space.store.get(project.id)?.version).toBe(project.version + 1);
  expect(space.store.get(quant.id)?.version).toBe(quant.version);
});

test("只启用阅读学习即可保存材料、阅读与解释，词汇和语言目标明确要求语言模块", async ({
  page,
  space,
}) => {
  await ready(page, space);
  await navigate(page, "数据与设置");
  for (const module of space.store
    .modules()
    .filter((module) => module.id !== "learning")) {
    const row = page.locator(`[data-module-id="${module.id}"]`);
    await row.getByRole("button", { name: /^停用 / }).click();
    await expect(row).toContainText("历史保留");
  }
  await navigate(page, "阅读学习");
  const panel = await openMaterialForm(page, "虚构基础阅读单独可用");
  await expect(
    panel.getByRole("button", { name: "建立语言目标", exact: true }),
  ).toBeDisabled();
  await panel
    .getByRole("button", { name: "保存材料原文", exact: true })
    .click();
  await expect(page.locator(".message.success")).toContainText(
    "材料原文与来源已保存",
  );
  await expect(
    panel
      .locator(".reading-material")
      .getByRole("heading", { name: "虚构基础阅读单独可用", exact: true }),
  ).toBeVisible();
  const savedMaterials = (
    await get<Entity[]>(page, space, "/api/entities")
  ).filter((entity) => entity.type === "material");
  expect(savedMaterials).toHaveLength(1);
  expect(savedMaterials[0].title).toBe("虚构基础阅读单独可用");
  expect(savedMaterials[0].body).toBe(
    "这是一段为浏览器验证创作的虚构材料原文。",
  );
  await panel.getByLabel("本次阅读分钟", { exact: true }).fill("11");
  await panel
    .getByRole("button", { name: "记录本次阅读", exact: true })
    .click();
  await expect(panel.getByLabel("本次阅读分钟", { exact: true })).toHaveValue(
    "",
  );
  const evidence = panel
    .locator("details.manual-import")
    .filter({ hasText: "辅助解释与词汇（不新增分钟）" });
  if (
    !(await evidence.evaluate(
      (element) => (element as HTMLDetailsElement).open,
    ))
  )
    await evidence.locator(":scope > summary").click();
  await panel
    .getByLabel("辅助解释", { exact: true })
    .fill("根据原文写下的虚构草稿解释。");
  await panel
    .getByRole("button", { name: "保存草稿解释", exact: true })
    .click();
  await expect(panel.getByLabel("辅助解释", { exact: true })).toHaveValue("");
  await expect(
    panel.getByRole("button", { name: "保存词汇复习项", exact: true }),
  ).toBeDisabled();
  await expect(panel).toContainText("词汇复习需启用并升级语言模块");
  const report = await get<{ uniqueTotalMinutes: number }>(
    page,
    space,
    "/api/reports/reading",
  );
  expect(report.uniqueTotalMinutes).toBe(11);
  expect(
    (await get<Entity[]>(page, space, "/api/entities")).filter(
      (entity) => entity.module === "languages",
    ),
  ).toHaveLength(0);
});

test("个人韩语配置需明确升级，旧字段保留，共享阅读与词汇只计一次分钟", async ({
  page,
  space,
}) => {
  await ready(page, space);
  const material = await post<Entity>(page, space, "/api/reading/materials", {
    operationId: "fictional-legacy-material",
    title: "虚构旧语言材料",
    reference: "local:fictional-legacy",
    sourceType: "技术文档",
    language: "英语",
    rights: "本人创作",
    body: "旧语言值与原文须完整保留。",
    occurredAt: "2030-01-01T09:00:00Z",
    timeZone: "UTC",
  });
  await post(page, space, "/api/reading/sessions", {
    operationId: "fictional-legacy-session",
    materialId: material.id,
    minutes: 7,
    goalIds: [],
    occurredAt: "2030-01-01T09:30:00Z",
    timeZone: "UTC",
  });
  const before = await get<Entity[]>(page, space, "/api/entities");
  await navigate(page, "数据与设置");
  const settings = page.locator(".personalization-settings");
  await settings.getByLabel("自定义语言代码", { exact: true }).fill("ko");
  await settings.getByLabel("自定义语言名称", { exact: true }).fill("韩语");
  await settings
    .getByRole("button", { name: "加入语言选择", exact: true })
    .click();
  await expect(settings.getByLabel("学习 韩语", { exact: true })).toBeChecked();
  await settings
    .getByRole("button", { name: "保存个人设置", exact: true })
    .click();
  await expect(
    settings.getByRole("button", { name: "保存个人设置", exact: true }),
  ).toBeDisabled();
  expect(space.store.module("learning").schemaVersion).toBe(2);
  expect(space.store.module("languages").schemaVersion).toBe(2);
  await settings
    .getByRole("button", { name: "明确升级扩展语言 阅读学习", exact: true })
    .click();
  await expect(settings.locator('[data-module-id="learning"]')).toContainText(
    "Schema 3",
  );
  await settings
    .getByRole("button", {
      name: `明确升级扩展语言 ${space.store.module("languages").name}`,
      exact: true,
    })
    .click();
  await expect(settings.locator('[data-module-id="languages"]')).toContainText(
    "Schema 3",
  );
  for (const original of before) {
    expect(space.store.get(original.id)?.fields).toEqual(original.fields);
    expect(space.store.get(original.id)?.body).toBe(original.body);
  }
  await navigate(page, "阅读学习");
  const panel = page.locator(".reading-workspace");
  await panel
    .getByRole("button", { name: "建立语言目标", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("标题", { exact: true }).fill("虚构韩语阅读目标");
  await dialog.getByLabel("语言", { exact: true }).selectOption("ko");
  await dialog.getByRole("button", { name: "保存记录", exact: true }).click();
  await expect(dialog).toBeHidden();
  await openMaterialForm(page, "虚构韩语共享阅读材料");
  await panel.getByLabel("材料语言", { exact: true }).selectOption("ko");
  await panel
    .getByRole("button", { name: "保存材料原文", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "✓ 材料已保存", exact: true }),
  ).toBeVisible();
  await panel.getByRole("checkbox", { name: /虚构韩语阅读目标/ }).check();
  await panel.getByLabel("本次阅读分钟", { exact: true }).fill("30");
  await panel
    .getByRole("button", { name: "记录本次阅读", exact: true })
    .click();
  await expect(panel.getByLabel("本次阅读分钟", { exact: true })).toHaveValue(
    "",
  );
  const evidence = panel
    .locator("details.manual-import")
    .filter({ hasText: "辅助解释与词汇（不新增分钟）" });
  if (
    !(await evidence.evaluate(
      (element) => (element as HTMLDetailsElement).open,
    ))
  )
    await evidence.locator(":scope > summary").click();
  await panel.getByLabel("词汇或短语", { exact: true }).fill("학습");
  await panel.getByLabel("词义或理解", { exact: true }).fill("学习");
  await panel
    .getByLabel("词汇原文上下文", { exact: true })
    .fill("虚构韩语词汇上下文。");
  await panel
    .getByRole("button", { name: "保存词汇复习项", exact: true })
    .click();
  await expect(panel.getByLabel("词汇或短语", { exact: true })).toHaveValue("");
  const report = await get<{
    uniqueTotalMinutes: number;
    byLanguage: { language: string; minutes: number }[];
  }>(page, space, "/api/reports/reading");
  expect(report.uniqueTotalMinutes).toBe(37);
  expect(
    report.byLanguage.find((row) => row.language === "韩语")?.minutes,
  ).toBe(30);
  expect(
    (await get<Entity[]>(page, space, "/api/entities")).find(
      (entity) => entity.title === "虚构韩语共享阅读材料",
    )?.fields.language,
  ).toBe("ko");
});

test("模板选择与预览零写入，明确采用响应失败保留参数并以相同操作重试一次", async ({
  page,
  space,
}) => {
  await ready(page, space);
  await navigate(page, "数据与设置");
  const chooser = page.locator(".template-chooser");
  const card = chooser.locator('[data-template-id="reading.basic"]');
  await card.getByRole("checkbox").click();
  await expect(card.getByRole("checkbox")).toBeChecked();
  expect(
    (await get<PersonalProfile>(page, space, "/api/profile"))
      .templatePreferences.enabledIds,
  ).toContain("reading.basic");
  await expect(
    card.getByRole("button", { name: "配置 阅读学习计划", exact: true }),
  ).toBeEnabled();
  expect(await get<Entity[]>(page, space, "/api/entities")).toHaveLength(0);
  await card
    .getByRole("button", { name: "配置 阅读学习计划", exact: true })
    .click();
  await chooser
    .getByLabel("模板参数 计划标题", { exact: true })
    .fill("虚构明确采用的阅读计划");
  await chooser
    .getByLabel("模板参数 关注点", { exact: true })
    .fill("仅在预览中填写的虚构关注点");
  await chooser
    .getByRole("button", { name: "预览模板计划", exact: true })
    .click();
  await expect(
    chooser.getByLabel("模板计划预览", { exact: true }),
  ).toContainText("虚构明确采用的阅读计划");
  expect(await get<Entity[]>(page, space, "/api/entities")).toHaveLength(0);
  const attempts: { operationId: string }[] = [];
  await page.route("**/api/templates/apply", async (route) => {
    attempts.push(route.request().postDataJSON());
    const response = await route.fetch();
    if (attempts.length === 1)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "虚构响应丢失，请重试核对。" }),
      });
    else await route.fulfill({ response });
  });
  await chooser
    .getByRole("button", { name: "明确采用为计划", exact: true })
    .click();
  await expect(chooser.getByRole("alert")).toContainText("采用失败");
  await expect(
    chooser.getByLabel("模板参数 计划标题", { exact: true }),
  ).toHaveValue("虚构明确采用的阅读计划");
  expect(await get<Entity[]>(page, space, "/api/entities")).toHaveLength(1);
  await chooser
    .getByRole("button", { name: "重试采用模板", exact: true })
    .click();
  await expect(
    chooser.getByRole("button", { name: "✓ 已采用模板", exact: true }),
  ).toBeDisabled();
  expect(attempts).toHaveLength(2);
  expect(attempts[1].operationId).toBe(attempts[0].operationId);
  const records = await get<Entity[]>(page, space, "/api/entities");
  expect(records).toHaveLength(1);
  expect(records[0].kind).toBe("plan");
  expect(records[0].fields).toEqual({ focus: "仅在预览中填写的虚构关注点" });
  expect(
    (
      await get<{ uniqueTotalMinutes: number }>(
        page,
        space,
        "/api/reports/reading",
      )
    ).uniqueTotalMinutes,
  ).toBe(0);
});

test("个人模板同ID不同版本按所选版本预览采用，非法JSON模板保留原文供修正", async ({
  page,
  space,
}) => {
  await ready(page, space);
  const template = (version: number): TemplateDefinition => ({
    id: "personal.versioned",
    version,
    name: `虚构版本模板 ${version}`,
    requires: ["learning"],
    parameters: [],
    target: {
      module: "learning",
      type: "checklist-item",
      kind: "plan",
      status: "draft",
    },
    defaults: {
      title: `虚构v${version}计划`,
      body: `第${version}版的虚构默认值。`,
      fields: { focus: `v${version}` },
    },
  });
  await post(page, space, "/api/templates/register", { template: template(1) });
  await post(page, space, "/api/templates/register", { template: template(2) });
  await navigate(page, "数据与设置");
  const chooser = page.locator(".template-chooser");
  const first = chooser.locator(
    '[data-template-id="personal.versioned"][data-template-version="1"]',
  );
  await first.getByRole("checkbox").click();
  await expect(first.getByRole("checkbox")).toBeChecked();
  expect(
    (await get<PersonalProfile>(page, space, "/api/profile"))
      .templatePreferences.enabledIds,
  ).toContain("personal.versioned");
  await expect(
    first.getByRole("button", { name: "配置 虚构版本模板 1", exact: true }),
  ).toBeEnabled();
  await first
    .getByRole("button", { name: "配置 虚构版本模板 1", exact: true })
    .click();
  await chooser
    .getByRole("button", { name: "预览模板计划", exact: true })
    .click();
  await expect(
    chooser.getByLabel("模板计划预览", { exact: true }),
  ).toContainText("虚构v1计划");
  await chooser
    .getByRole("button", { name: "明确采用为计划", exact: true })
    .click();
  await expect(
    chooser.getByRole("button", { name: "✓ 已采用模板", exact: true }),
  ).toBeDisabled();
  const records = await get<Entity[]>(page, space, "/api/entities");
  expect(records.map((entity) => entity.title)).toEqual(["虚构v1计划"]);
  await chooser.locator(".template-import > summary").click();
  const invalid = JSON.stringify({
    ...template(3),
    code: "window.personalizationUnsafe = true",
  });
  await chooser.getByLabel("个人模板 JSON", { exact: true }).fill(invalid);
  await chooser
    .getByRole("button", { name: "校验并登记模板", exact: true })
    .click();
  await expect(chooser.getByRole("alert")).toContainText("导入模板失败");
  await expect(
    chooser.getByLabel("个人模板 JSON", { exact: true }),
  ).toHaveValue(invalid);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as Record<string, unknown>).personalizationUnsafe,
    ),
  ).toBeUndefined();
  expect(await get<Entity[]>(page, space, "/api/entities")).toHaveLength(1);
});

test.describe("手机个人空间设置", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    timezoneId: "Asia/Shanghai",
  });
  test("语言选择、分类名称与模块归属保存后刷新保持，界面无横向溢出", async ({
    page,
    space,
  }) => {
    await ready(page, space);
    await navigate(page, "数据与设置");
    const settings = page.locator(".personalization-settings");
    await settings.getByLabel("学习 法语", { exact: true }).uncheck();
    await settings
      .getByLabel("分类显示名称 language", { exact: true })
      .fill("我的语言");
    await settings
      .getByLabel("模块分类 projects", { exact: true })
      .selectOption("learning");
    await settings
      .getByRole("button", { name: "上移分类 language", exact: true })
      .click();
    await settings
      .getByRole("button", { name: "保存个人设置", exact: true })
      .click();
    await expect(
      settings.getByRole("button", { name: "保存个人设置", exact: true }),
    ).toBeDisabled();
    await page.reload();
    await expect(
      page.getByText("本地服务已连接", { exact: true }),
    ).toBeVisible();
    const profile = await get<PersonalProfile>(page, space, "/api/profile");
    expect(profile.languagePreferences.activeCodes).not.toContain("fr");
    expect(profile.navigation.labels.language).toBe("我的语言");
    expect(profile.navigation.moduleCategories.projects).toBe("learning");
    await navigate(page, "数据与设置");
    await expect(
      settings.getByLabel("学习 法语", { exact: true }),
    ).not.toBeChecked();
    await expect(
      settings.getByLabel("分类显示名称 language", { exact: true }),
    ).toHaveValue("我的语言");
    await expect(
      settings.getByLabel("模块分类 projects", { exact: true }),
    ).toHaveValue("learning");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await navigate(page, "我的语言");
    await expect(
      page.getByRole("heading", {
        name: space.store.module("languages").name,
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: "/tmp/life-personalization-mobile.png",
      fullPage: true,
    });
  });
});
