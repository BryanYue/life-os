import { test, expect, type Page } from "@playwright/test";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { app } from "../../src/server.js";
import { Store } from "../../src/store.js";
import { exportBootstrap, exportProjection } from "../../src/sync.js";
import type {
  EntityInput,
  Module,
  SyncBootstrap,
  SyncProjection,
} from "../../src/types.js";
import type { PluginManifest } from "../../src/plugins.js";
let fixtureRoot: string;
let receiver: Store;
let source: Store;
let server: ReturnType<typeof app>;
let baseline: SyncBootstrap;
let projection: SyncProjection;
let manifestPath: string;
let upgradePath: string;
const base = (extra: Partial<EntityInput> = {}): EntityInput => ({
  module: "planning",
  type: "goal",
  title: "虚构同步共享目标",
  kind: "plan",
  status: "active",
  occurredAt: "2040-01-01T09:00:00Z",
  timeZone: "UTC",
  fields: { measure: "共享完成标准", horizon: "虚构隐藏阶段" },
  relations: [],
  body: "虚构未共享正文",
  ...extra,
});
test.beforeAll(async () => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "life-ui-lifecycle-"));
  receiver = new Store(join(fixtureRoot, "receiver"));
  source = new Store(join(fixtureRoot, "source"));
  const module: Module = JSON.parse(
    readFileSync("examples/plants.json", "utf8"),
  );
  source.register(module);
  source.save({ entity: base(), expectedVersion: 0 });
  source.save({
    entity: base({
      module: "example.plants",
      type: "plant",
      title: "虚构初始化植物",
      fields: { species: "虚构蕨类" },
      body: "仅用于浏览器验证",
    }),
    expectedVersion: 0,
  });
  baseline = exportBootstrap(source, ["planning", "example.plants"]);
  projection = exportProjection(source, {
    modules: ["planning"],
    entities: {
      planning: {
        fields: ["measure"],
        body: false,
        relations: false,
        metadata: ["title"],
      },
    },
  });
  const config = { syncScope: { modules: ["planning", "example.plants"] } };
  writeFileSync(join(receiver.root, "config.json"), JSON.stringify(config));
  cpSync("examples/plugin-plants", join(fixtureRoot, "code-v1"), {
    recursive: true,
  });
  cpSync("examples/plugin-plants", join(fixtureRoot, "code-v2"), {
    recursive: true,
  });
  manifestPath = join(fixtureRoot, "code-v1", "manifest.json");
  upgradePath = join(fixtureRoot, "code-v2", "manifest.json");
  const upgraded: PluginManifest = JSON.parse(
    readFileSync(upgradePath, "utf8"),
  );
  upgraded.module.version = "1.1.0";
  writeFileSync(upgradePath, JSON.stringify(upgraded));
  server = app(receiver, { ...config, assets: resolve("web-dist") });
  await server.listen({ host: "127.0.0.1", port: 5173 });
});
test.afterAll(async () => {
  await server?.close();
  receiver?.close();
  source?.close();
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
});
async function settings(page: Page) {
  await page.goto("http://127.0.0.1:5173/");
  await expect(page.getByText("本地服务已连接", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "数据与设置", exact: true }).click();
}

test("本地同步：授权、只读字段投影、明确清单接受及初始化重放", async ({
  page,
}) => {
  await settings(page);
  const tools = page.getByRole("region", { name: "本地同步工具" });
  await tools.getByRole("button", { name: "读取授权与投影" }).click();
  await expect(tools).toContainText("未接通云同步");
  await expect(tools).toContainText("example.plants");
  await tools
    .locator("summary")
    .filter({ hasText: "手动导入初始化或投影 JSON" })
    .click();
  await expect(
    tools.getByLabel("接受初始化包中的模块清单（acceptManifests）"),
  ).not.toBeChecked();
  await tools.getByLabel("导入包类型").selectOption("projection");
  await tools.getByLabel("选择同步 JSON 文件").setInputFiles({
    name: "fictional-projection.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(projection)),
  });
  await tools.getByRole("button", { name: "处理本地同步 JSON" }).click();
  await expect(tools.locator(".import-result")).toContainText(
    "本次应用 1 条 · 只读",
  );
  const view = tools.locator(".projection-card");
  await expect(view).toContainText("只读 · 1 条");
  await view.locator("summary").click();
  await expect(view).toContainText("共享完成标准");
  await expect(view).not.toContainText("虚构隐藏阶段");
  await expect(view).not.toContainText("虚构未共享正文");
  await expect(view.getByRole("button")).toHaveCount(0);
  expect(receiver.list().length).toBe(0);
  const download = page.waitForEvent("download");
  await tools.getByRole("button", { name: "导出只读投影 JSON" }).click();
  expect((await download).suggestedFilename()).toContain("projection");
  await tools.getByLabel("导入包类型").selectOption("bootstrap");
  await tools.getByLabel("同步 JSON 内容").fill(JSON.stringify(baseline));
  await tools.getByRole("button", { name: "处理本地同步 JSON" }).click();
  await expect(page.getByRole("alert")).toContainText("manifest acceptance");
  expect(receiver.list().length).toBe(0);
  await tools.getByLabel("接受初始化包中的模块清单（acceptManifests）").check();
  await tools.getByRole("button", { name: "处理本地同步 JSON" }).click();
  await expect(tools.locator(".import-result")).toContainText(
    "初始化基线 · 本次应用 2 条",
  );
  await expect(
    page.getByRole("button", { name: "植物养护", exact: true }),
  ).toBeVisible();
  await tools.getByRole("button", { name: "处理本地同步 JSON" }).click();
  await expect(tools.locator(".import-result")).toContainText("本次应用 0 条");
  expect(receiver.list().length).toBe(2);
});

test("已有示例插件：安装、权限与stdio双确认、表单推断、导入、升级与卸载保留数据", async ({
  page,
}) => {
  await settings(page);
  const tools = page.getByRole("region", { name: "本地插件工具" });
  await tools.getByLabel("插件清单本地路径").fill(manifestPath);
  await tools.getByRole("button", { name: "安装本地插件" }).click();
  const plugin = tools.getByRole("article", {
    name: "插件 demo.plugin-plants",
  });
  await expect(plugin.locator(".plugin-state")).toContainText("待授权");
  await expect(plugin.getByRole("button", { name: "启用插件" })).toBeDisabled();
  await plugin
    .locator("summary")
    .filter({ hasText: "权限授权与本地代码信任" })
    .click();
  await plugin.getByLabel("授权 read-plants", { exact: true }).check();
  await plugin.getByLabel("授权 suggest-plants", { exact: true }).check();
  await expect(
    plugin.getByLabel("授权 external-plants", { exact: true }),
  ).toBeDisabled();
  await expect(plugin).toContainText("nickname, waterMl");
  await plugin.getByRole("button", { name: "保存明确授权" }).click();
  await plugin.getByRole("button", { name: "启用插件" }).click();
  await expect(plugin.locator(".plugin-state")).toContainText("已启用");
  await expect(
    page.getByRole("button", { name: "Fictional plugin plants", exact: true }),
  ).toBeVisible();
  await plugin
    .locator("summary")
    .filter({ hasText: "调用操作与手动导入" })
    .click();
  await plugin
    .getByLabel("插件操作", { exact: true })
    .selectOption("summarize");
  await expect(
    plugin.getByRole("button", { name: "调用插件操作" }),
  ).toBeDisabled();
  await plugin
    .locator("summary")
    .filter({ hasText: "权限授权与本地代码信任" })
    .click();
  await plugin.getByLabel("我已审阅并信任此插件的本地代码").check();
  await expect(
    plugin.getByRole("button", { name: "保存明确授权" }),
  ).toBeDisabled();
  await plugin.getByLabel("我理解网络和系统调用未隔离的风险").check();
  await plugin.getByRole("button", { name: "保存明确授权" }).click();
  await plugin.getByRole("button", { name: "启用插件" }).click();
  await plugin
    .locator("summary")
    .filter({ hasText: "调用操作与手动导入" })
    .click();
  await plugin
    .getByLabel("插件操作", { exact: true })
    .selectOption("summarize");
  await plugin.getByRole("button", { name: "调用插件操作" }).click();
  await expect(plugin.locator(".plugin-output")).toContainText("count");
  await expect(plugin.locator(".plugin-output")).toContainText("waterMl");
  await plugin.getByLabel("插件操作", { exact: true }).selectOption("suggest");
  await plugin.getByLabel("插件记录标题").fill("虚构插件表单建议");
  await plugin
    .getByLabel("插件记录发生时间（带时差 ISO）")
    .fill("2040-01-01T09:00:00Z");
  await plugin.getByLabel("插件记录时区").fill("UTC");
  await plugin
    .getByLabel("Fictional nickname", { exact: true })
    .fill("虚构蕨类");
  await plugin.getByLabel("Water millilitres", { exact: true }).fill("25");
  await expect(
    plugin.getByLabel("Fictional hidden field", { exact: true }),
  ).toHaveCount(0);
  await plugin.getByRole("button", { name: "调用插件操作" }).click();
  await expect(plugin.locator(".plugin-output")).toContainText(
    "虚构插件表单建议",
  );
  const imported = {
    expectedVersion: 0,
    entity: base({
      module: "demo.plugin-plants",
      type: "plant",
      title: "虚构插件导入建议",
      kind: "inference",
      status: "draft",
      fields: { nickname: "虚构导入蕨类", waterMl: 10 },
      body: "",
    }),
  };
  await plugin.getByLabel("选择插件导入文件").setInputFiles({
    name: "fictional-plugin-input.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await plugin.getByRole("button", { name: "运行插件导入器" }).click();
  await expect(plugin.locator(".plugin-output")).toContainText(
    "虚构插件导入建议",
  );
  expect(receiver.list({ module: "demo.plugin-plants" }).length).toBe(2);
  await plugin.getByRole("button", { name: "禁用插件" }).click();
  await expect(plugin.locator(".plugin-state")).toContainText("已禁用");
  await tools.getByLabel("插件清单本地路径").fill(upgradePath);
  await tools.getByLabel("安装或升级").selectOption("upgrade");
  await tools.getByRole("button", { name: "升级本地插件" }).click();
  await expect(plugin).toContainText("v1.1.0");
  await expect(plugin.getByRole("button", { name: "启用插件" })).toBeDisabled();
  await plugin.getByRole("button", { name: "卸载并保留数据" }).click();
  await expect(plugin.locator(".plugin-state")).toContainText(
    "已卸载，数据保留",
  );
  expect(receiver.list({ module: "demo.plugin-plants" }).length).toBe(2);
});

test("同步授权显示与真实配置一致：实体选择、投影、缺失范围、亲属拒绝与空授权", async ({
  page,
}) => {
  async function restart(scope: import("../../src/types.js").SyncScope) {
    await server.close();
    writeFileSync(
      join(receiver.root, "config.json"),
      JSON.stringify({ syncScope: scope }),
    );
    const config = JSON.parse(
      readFileSync(join(receiver.root, "config.json"), "utf8"),
    );
    server = app(receiver, { ...config, assets: resolve("web-dist") });
    await server.listen({ host: "127.0.0.1", port: 5173 });
    await settings(page);
    await page
      .getByRole("region", { name: "本地同步工具" })
      .getByRole("button", { name: "读取授权与投影" })
      .click();
  }
  await restart({
    modules: ["planning", "learning", "family"],
    entities: { planning: { entityTypes: ["goal"] } },
  });
  const tools = page.getByRole("region", { name: "本地同步工具" });
  await expect(
    tools.locator("tbody tr").filter({ hasText: "planning" }),
  ).toContainText("完整记录");
  await expect(
    tools.locator("tbody tr").filter({ hasText: "learning" }),
  ).toContainText("未指定实体范围，当前无记录授权");
  await expect(
    tools.locator("tbody tr").filter({ hasText: "family" }),
  ).toContainText("亲属模块不参与同步");
  await restart({
    modules: ["planning"],
    entities: { planning: { fields: ["measure"], metadata: ["title"] } },
  });
  await expect(tools.locator("tbody tr")).toContainText(
    "正文隐藏 · 关系隐藏 · 元数据title",
  );
  await expect(tools.locator("tbody tr")).not.toContainText("完整记录");
  await restart({ modules: [] });
  await expect(tools).toContainText("当前授权模块为空，没有授权导出业务记录");
});
