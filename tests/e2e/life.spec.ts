import { test, expect, type Page } from "@playwright/test";
import type { Module } from "../../src/types.js";
const names = [
  "生活规划",
  "运动健康",
  "阅读学习",
  "AI / Agent 实践",
  "英语 / 日语",
  "量化研究",
  "资产财务",
  "亲属关系",
];
async function ready(page: Page) {
  await page.goto("/");
  await expect(page.getByText("本地服务已连接", { exact: true })).toBeVisible();
}
async function create(
  page: Page,
  title: string,
  type: string,
  kind: string,
  fields: Module["entityTypes"][number]["fields"] = [],
) {
  await page
    .getByRole("button", { name: /新建记录/ })
    .first()
    .click();
  const d = page.getByRole("dialog");
  await d.getByLabel("标题", { exact: true }).fill(title);
  await d.getByLabel("记录类型", { exact: true }).selectOption(type);
  await d.getByLabel("记录性质", { exact: true }).selectOption(kind);
  for (const f of fields.filter((f) => f.required)) {
    const el = d.getByLabel(f.label, { exact: false });
    if (f.type === "select") await el.selectOption(f.options![0]);
    else
      await el.fill(
        f.type === "number"
          ? "10"
          : f.type === "decimal"
            ? "0.10"
            : f.type === "date"
              ? "2030-04-01"
              : f.key === "currency"
                ? "USD"
                : f.key === "parameters"
                  ? "{}"
                  : "虚构测试",
      );
  }
  await d.locator("textarea").fill("## 虚构记录\n\n只用于自动化验证。");
  return d;
}
for (const name of names)
  test(name + "：创建、编辑、关联、查询、复盘", async ({ page }) => {
    await ready(page);
    await page.getByRole("button", { name, exact: true }).click();
    const modules: Module[] = await (
      await page.request.get("/api/modules")
    ).json();
    const module = modules.find((m) => m.name === name)!;
    let d = await create(page, name + " · 测试目标", "goal", "plan");
    await d.getByRole("button", { name: "保存记录", exact: true }).click();
    await expect(d).toBeHidden();
    const business = module.entityTypes.find(
      (t) => !["goal", "review"].includes(t.id),
    )!;
    d = await create(
      page,
      name + " · 实际记录",
      business.id,
      "fact",
      business.fields,
    );
    await d
      .getByLabel("推进目标", { exact: false })
      .selectOption({ label: name + " · 测试目标 · 计划" });
    await d.getByRole("button", { name: "保存记录", exact: true }).click();
    await expect(d).toBeHidden();
    await page
      .locator(".record-main")
      .filter({ hasText: name + " · 实际记录" })
      .click();
    d = page.getByRole("dialog");
    await expect(d.getByLabel("记录性质", { exact: true })).toBeDisabled();
    await d.locator("textarea").fill("编辑后的虚构记录");
    await d.getByRole("button", { name: "保存记录", exact: true }).click();
    await expect(d).toBeHidden();
    await page.getByLabel("搜索记录").fill("实际记录");
    await expect(page.locator(".record-main")).toHaveCount(1);
    await page.getByLabel("搜索记录").fill("");
    await page.getByRole("button", { name: /写一份回顾/ }).click();
    d = page.getByRole("dialog");
    await d.getByLabel("标题", { exact: true }).fill(name + " · 复盘");
    await d
      .getByLabel("证据", { exact: false })
      .selectOption({ label: name + " · 实际记录 · 事实" });
    await d.locator("textarea").fill("对照计划与事实，下一步维持低强度。");
    await d.getByRole("button", { name: "保存记录", exact: true }).click();
    await expect(d).toBeHidden();
    await page.reload();
    await expect(
      page.getByText("本地服务已连接", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
      page.locator(".record-main").filter({ hasText: name + " · 复盘" }),
    ).toHaveCount(1);
  });
test("规划采纳、两记录比较、回收站、备份与手机视图", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: "生活规划", exact: true }).click();
  for (const [title, kind] of [
    ["独立比较计划", "plan"],
    ["独立比较事实", "fact"],
  ]) {
    const dialog = await create(page, title, "goal", kind);
    await dialog.getByRole("button", { name: "保存记录", exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  await page.getByRole("button", { name: "时间规划", exact: true }).click();
  await page.getByLabel("目标", { exact: true }).fill("虚构浏览器目标");
  await page.getByLabel("用餐", { exact: true }).fill("30");
  await page.getByRole("button", { name: /生成本地规则建议/ }).click();
  await page
    .getByRole("button", { name: "确认并保存为计划", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "✓ 已保存为计划", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "生活规划", exact: true }).click();
  await page.getByRole("button", { name: /比较两条记录/ }).click();
  await page
    .getByLabel("记录 A", { exact: true })
    .selectOption({ label: "独立比较计划 · 计划" });
  await page
    .getByLabel("记录 B", { exact: true })
    .selectOption({ label: "独立比较事实 · 事实" });
  await expect(page.locator(".comparison-panel table")).toContainText("来源");
  await page
    .locator(".record-main")
    .filter({ hasText: "虚构浏览器目标" })
    .click();
  const d = page.getByRole("dialog");
  await d.getByRole("button", { name: "移入回收站", exact: true }).click();
  await expect(d).toBeHidden();
  await expect(
    page.locator(".record-main").filter({ hasText: "虚构浏览器目标" }),
  ).toHaveCount(0);
  await page.getByLabel("显示回收站").check();
  await page
    .locator(".record-row")
    .filter({ hasText: "虚构浏览器目标" })
    .getByRole("button", { name: "恢复", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("恢复");
  await page.getByRole("button", { name: "数据与设置", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出完整备份/ }).click();
  expect((await download).suggestedFilename()).toContain(".json");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "展开导航", exact: true }).click();
  await page.getByRole("button", { name: "阅读学习", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "阅读学习", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("另一个窗口修改后，409保留未保存正文", async ({ page }) => {
  const session = page.waitForResponse((r) => r.url().endsWith("/api/session"));
  await ready(page);
  const csrf = (await (await session).json()).csrf;
  await page.getByRole("button", { name: "阅读学习", exact: true }).click();
  const initial = await create(page, "独立冲突记录", "note", "fact");
  await initial.getByRole("button", { name: "保存记录", exact: true }).click();
  await expect(initial).toBeHidden();
  await page
    .locator(".record-main")
    .filter({ hasText: "独立冲突记录" })
    .click();
  const d = page.getByRole("dialog");
  await d.locator("textarea").fill("未保存文本必须保留");
  const entities = await (await page.request.get("/api/entities")).json();
  const e = entities.find((r: { title: string }) => r.title === "独立冲突记录");

  const response = await page.request.post("/api/entities", {
    headers: { "x-csrf-token": csrf },
    data: {
      entity: { ...e, title: e.title + " 更新" },
      expectedVersion: e.version,
      expectedNoteHash: e.noteHash,
    },
  });
  expect(response.status()).toBe(200);
  await d.getByRole("button", { name: "保存记录", exact: true }).click();
  await expect(d.getByRole("alert")).toContainText("版本冲突");
  await expect(d.locator("textarea")).toHaveValue("未保存文本必须保留");
});

test("声明式植物模块自动生成表单、关系与时间线", async ({ page }) => {
  const session = page.waitForResponse((r) => r.url().endsWith("/api/session"));
  await ready(page);
  const csrf = (await (await session).json()).csrf;
  const { readFileSync } = await import("node:fs");
  const manifest: Module = JSON.parse(
    readFileSync("examples/plants.json", "utf8"),
  );
  const response = await page.request.post("/api/modules", {
    headers: { "x-csrf-token": csrf },
    data: manifest,
  });
  expect(response.status()).toBe(200);
  await page.reload();
  await page.getByRole("button", { name: "植物养护", exact: true }).click();
  let d = await create(
    page,
    "虚构浏览器植物",
    "plant",
    "fact",
    manifest.entityTypes[0].fields,
  );
  await d.getByRole("button", { name: "保存记录", exact: true }).click();
  await expect(d).toBeHidden();
  d = await create(page, "虚构浏览器养护", "care", "fact");
  await d.getByLabel("浇水毫升", { exact: false }).fill("120");
  await d
    .getByLabel("关联植物、费用、目标", { exact: false })
    .selectOption({ label: "虚构浏览器植物 · 事实" });
  await d.getByRole("button", { name: "保存记录", exact: true }).click();
  await expect(d).toBeHidden();
  await page.getByRole("button", { name: "时间线视图", exact: true }).click();
  await expect(page.locator(".record-list.timeline")).toContainText(
    "虚构浏览器养护",
  );
  await page.getByRole("button", { name: /写一份回顾/ }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("标题", { exact: true }).fill("虚构植物复盘");
  await d
    .getByLabel("关联植物、费用、目标", { exact: false })
    .selectOption({ label: "虚构浏览器养护 · 事实" });
  await d.locator("textarea").fill("对照虚构养护与费用记录。");
  await d.getByRole("button", { name: "保存记录", exact: true }).click();
  await expect(d).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: "植物养护", exact: true }).click();
  await expect(
    page.locator(".record-main").filter({ hasText: "虚构植物复盘" }),
  ).toHaveCount(1);
});
