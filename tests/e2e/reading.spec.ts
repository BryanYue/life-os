import { test, expect, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { app } from "../../src/server.js";
import { Store } from "../../src/store.js";
import { legacyBuiltins } from "../../src/modules.js";
import type { Entity, EntityInput } from "../../src/types.js";
async function openLearning(page: Page) {
  await page.goto("/");
  await expect(page.getByText("本地服务已连接", { exact: true })).toBeVisible();
  if (
    await page
      .getByRole("button", { name: "展开导航", exact: true })
      .isVisible()
  )
    await page.getByRole("button", { name: "展开导航", exact: true }).click();
  await page.getByRole("button", { name: "阅读学习", exact: true }).click();
}
async function seed(page: Page, input: Partial<EntityInput>) {
  const { csrf } = await (await page.request.get("/api/session")).json();
  const response = await page.request.post("/api/entities", {
    headers: { "x-csrf-token": csrf },
    data: {
      expectedVersion: 0,
      entity: {
        module: "learning",
        type: "goal",
        title: "虚构目标",
        kind: "plan",
        status: "active",
        occurredAt: new Date().toISOString(),
        timeZone: "UTC",
        fields: {},
        relations: [],
        body: "仅用于浏览器验证。",
        ...input,
      },
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as Entity;
}
async function readingReport(page: Page) {
  return await (await page.request.get("/api/reports/reading")).json();
}
async function allEntities(page: Page): Promise<Entity[]> {
  return await (await page.request.get("/api/entities")).json();
}
async function material(page: Page, title: string, original: string) {
  const panel = page.locator(".reading-workspace");
  const details = panel.locator("details.manual-import");
  if (!(await details.getAttribute("open"))) {
    if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open)))
      await details.locator(":scope > summary").click();
  }
  await panel.getByLabel("材料标题", { exact: true }).fill(title);
  await panel
    .getByLabel("来源 URL 或引用", { exact: true })
    .fill("local:fictional-reader-source");
  await panel
    .getByLabel("原文保存依据", { exact: true })
    .selectOption("本人创作");
  await panel.getByLabel("材料原文", { exact: true }).fill(original);
  return panel;
}
test("桌面阅读：原文响应丢失重试、双目标30分钟、解释词汇零分钟及来源编辑", async ({
  page,
}) => {
  await openLearning(page);
  const panel = page.locator(".reading-workspace");
  await panel
    .getByRole("button", { name: "建立领域目标", exact: true })
    .click();
  const editor = page.getByRole("dialog");
  await expect(editor.getByLabel("记录类型", { exact: true })).toHaveValue(
    "goal",
  );
  await expect(editor.getByLabel("记录性质", { exact: true })).toHaveValue(
    "plan",
  );
  await expect(editor.getByLabel("状态", { exact: true })).toHaveValue(
    "active",
  );
  await editor.getByLabel("标题", { exact: true }).fill("虚构桌面金融阅读目标");
  await editor.getByRole("button", { name: "保存记录", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await panel
    .getByRole("button", { name: "建立语言目标", exact: true })
    .click();
  await expect(editor.getByLabel("记录类型", { exact: true })).toHaveValue(
    "language-goal",
  );
  await editor.getByLabel("标题", { exact: true }).fill("虚构桌面英语阅读目标");
  await editor.getByLabel("语言", { exact: true }).selectOption("英语");
  await editor.getByRole("button", { name: "保存记录", exact: true }).click();
  await expect(editor).not.toBeVisible();
  const before = await readingReport(page);
  const original =
    "My fictional article links risk to evidence.\n<script>window.readingUnsafe = true</script>";
  await material(page, "虚构桌面双目标材料", original);
  let interrupted = false;
  await page.route("**/api/reading/materials", async (route) => {
    if (!interrupted) {
      interrupted = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await panel
    .getByRole("button", { name: "保存材料原文", exact: true })
    .click();
  await expect(
    page
      .locator(".message.error")
      .filter({ hasText: /fetch|Failed|Network/ })
      .first(),
  ).toBeVisible();
  await expect(panel.getByLabel("材料原文", { exact: true })).toHaveValue(
    original,
  );
  await panel
    .getByRole("button", { name: "保存材料原文", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "✓ 材料已保存", exact: true }),
  ).toBeVisible();
  expect(
    (await allEntities(page)).filter((e) => e.title === "虚构桌面双目标材料"),
  ).toHaveLength(1);
  await panel
    .getByLabel("虚构桌面金融阅读目标 阅读学习", { exact: true })
    .check();
  await panel
    .getByLabel("虚构桌面英语阅读目标 英语 / 日语 · 英语", { exact: true })
    .check();
  await panel.getByLabel("本次阅读分钟", { exact: true }).fill("30");
  await panel
    .getByRole("button", { name: "记录本次阅读", exact: true })
    .click();
  await expect(panel.getByLabel("本次阅读分钟", { exact: true })).toHaveValue(
    "",
  );
  let report = await readingReport(page);
  expect(report.uniqueTotalMinutes - before.uniqueTotalMinutes).toBe(30);
  for (const title of ["虚构桌面金融阅读目标", "虚构桌面英语阅读目标"])
    expect(
      report.byGoal.find((view: { title: string }) => view.title === title)
        .minutes,
    ).toBe(30);
  await panel.locator("summary").filter({ hasText: "辅助解释与词汇" }).click();
  await panel
    .getByLabel("辅助解释", { exact: true })
    .fill("这是手动整理的推断，尚未核实。");
  await panel
    .getByRole("button", { name: "保存草稿解释", exact: true })
    .click();
  await expect(panel.getByLabel("辅助解释", { exact: true })).toHaveValue("");
  await panel.getByLabel("词汇或短语", { exact: true }).fill("evidence");
  await panel.getByLabel("词义或理解", { exact: true }).fill("依据");
  await panel
    .getByLabel("词汇原文上下文", { exact: true })
    .fill("risk to evidence");
  await panel
    .getByRole("button", { name: "保存词汇复习项", exact: true })
    .click();
  await expect(panel.getByLabel("词汇或短语", { exact: true })).toHaveValue("");
  report = await readingReport(page);
  expect(report.uniqueTotalMinutes - before.uniqueTotalMinutes).toBe(30);
  expect(report.viewTotalsAdditive).toBe(false);
  const source = (await allEntities(page)).find(
    (e) => e.title === "虚构桌面双目标材料",
  )!;
  expect(source.body).toBe(original);
  expect(
    report.explanations.find(
      (row: { materialId: string }) => row.materialId === source.id,
    ).entity.kind,
  ).toBe("inference");
  expect(
    await page.evaluate(
      () => (window as unknown as Record<string, unknown>).readingUnsafe,
    ),
  ).toBeUndefined();
  await panel
    .locator(".reading-material")
    .getByRole("button", { name: source.title, exact: true })
    .click();
  await expect(editor.getByLabel("笔记", { exact: true })).toHaveValue(
    original,
  );
  await editor.getByRole("button", { name: "关闭编辑", exact: true }).click();
  await page.screenshot({
    path: "/tmp/life-reading-desktop.png",
    fullPage: true,
  });
});
test.describe("手机本地学习", () => {
  test.use({
    timezoneId: "Asia/Shanghai",
    viewport: { width: 390, height: 844 },
  });
  test("阅读→建议采纳→打卡撤销→本地提醒延后确认→回顾保留草稿", async ({
    page,
  }) => {
    await openLearning(page);
    const goal = await seed(page, { title: "虚构手机持续阅读目标" });
    await openLearning(page);
    const before = await readingReport(page);
    const panel = await material(
      page,
      "虚构手机英语材料",
      "This is an original fictional passage for mobile reading.",
    );
    await panel
      .getByRole("button", { name: "保存材料原文", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "✓ 材料已保存", exact: true }),
    ).toBeVisible();
    await panel.getByLabel("本次阅读分钟", { exact: true }).fill("10");
    const picker = panel.getByLabel("阅读发生时间", { exact: true });
    await expect(picker).toHaveAttribute("type", "datetime-local");
    await picker.fill("2037-03-01T18:30");
    await panel
      .getByRole("button", { name: "记录本次阅读", exact: true })
      .click();
    await expect(panel.getByLabel("本次阅读分钟", { exact: true })).toHaveValue(
      "",
    );
    expect(
      (await readingReport(page)).uniqueTotalMinutes -
        before.uniqueTotalMinutes,
    ).toBe(10);
    const savedMaterial = (await allEntities(page)).find(
      (e) => e.title === "虚构手机英语材料",
    )!;
    const session = (await allEntities(page)).find(
      (e) =>
        e.type === "session" &&
        e.relations.some((r) => r.target === savedMaterial.id),
    )!;
    expect(session.occurredAt).toBe("2037-03-01T18:30:00+08:00");
    await panel
      .getByLabel("本次收获", { exact: true })
      .fill("尚未保存的手机收获");
    await page.getByRole("tab", { name: "依据与建议", exact: true }).click();
    const advice = page.locator(".learning-workspace .advice-panel");
    await expect(
      advice.locator(".advice-card").filter({ hasText: goal.title }),
    ).toBeVisible();
    const suggestion = advice
      .locator(".advice-card")
      .filter({ hasText: goal.title });
    await suggestion
      .getByRole("button", { name: "采纳为学习待办", exact: true })
      .click();
    await expect(
      page.getByText("建议已采纳为学习待办", { exact: false }).first(),
    ).toBeVisible();
    await page.getByRole("tab", { name: "清单与提醒", exact: true }).click();
    const tasks = page.locator(".learning-tasks");
    const checklist = tasks
      .locator(".checklist-item")
      .filter({ hasText: goal.title });
    await expect(checklist).toHaveCount(1);
    await checklist.getByRole("checkbox").check();
    await expect(checklist.getByRole("checkbox")).toBeChecked();
    await checklist.getByRole("checkbox").uncheck();
    await expect(checklist.getByRole("checkbox")).not.toBeChecked();
    await tasks
      .locator("summary")
      .filter({ hasText: "添加应用内提醒" })
      .click();
    await tasks
      .getByLabel("提醒标题", { exact: true })
      .fill("虚构手机阅读提醒");
    const reminderTime = tasks.getByLabel("提醒时间", { exact: true });
    await expect(reminderTime).toHaveAttribute("type", "datetime-local");
    await reminderTime.fill("2037-03-01T19:00");
    await tasks
      .getByLabel("提醒关联的待办", { exact: true })
      .selectOption((await checklist.getAttribute("data-task-id")) as string);
    await tasks
      .getByRole("button", { name: "保存应用内提醒", exact: true })
      .click();
    const reminder = tasks
      .locator(".reminder-card")
      .filter({ hasText: "虚构手机阅读提醒" });
    await expect(reminder).toHaveCount(1);
    await reminder.locator("summary").filter({ hasText: "延后此提醒" }).click();
    await reminder
      .getByLabel("新的提醒时间", { exact: true })
      .fill("2037-03-01T20:00");
    await reminder
      .getByRole("button", { name: "保存延后时间", exact: true })
      .click();
    await expect(reminder).toContainText("20:00");
    await reminder
      .getByRole("button", { name: "确认此提醒", exact: true })
      .click();
    await tasks.locator("summary").filter({ hasText: "已确认提醒" }).click();
    await expect(
      tasks.locator(".reminder-card").filter({ hasText: "虚构手机阅读提醒" }),
    ).toContainText("已确认");
    const report = await (
      await page.request.get("/api/reports/learning-tasks")
    ).json();
    expect(report.checkIns.length).toBeGreaterThanOrEqual(2);
    expect(
      report.reminders.acknowledged.find(
        (e: Entity) => e.title === "虚构手机阅读提醒",
      ).fields.remindAt,
    ).toBe("2037-03-01T20:00:00+08:00");
    await page.getByRole("tab", { name: "同一材料阅读", exact: true }).click();
    await expect(panel.getByLabel("本次收获", { exact: true })).toHaveValue(
      "尚未保存的手机收获",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "/tmp/life-reading-mobile-shanghai.png",
      fullPage: true,
    });
  });
});
test("旧schema必须检查并明确迁移，两模块升级保留原文与备份且可重试", async ({
  page,
}) => {
  const root = mkdtempSync(join(tmpdir(), "life-ui-reading-upgrade-"));
  const store = new Store(join(root, "data"));
  for (const id of ["learning", "languages"])
    store.db
      .prepare("UPDATE modules SET json=? WHERE id=?")
      .run(JSON.stringify(legacyBuiltins.find((m) => m.id === id)), id);
  const original = store.save({
    expectedVersion: 0,
    entity: {
      module: "learning",
      type: "material",
      title: "虚构旧版原文",
      kind: "fact",
      status: "done",
      occurredAt: "2030-01-01T09:00:00Z",
      timeZone: "UTC",
      fields: {},
      relations: [],
      body: "旧版原文应保留。",
    },
  });
  const server = app(store, { assets: resolve("web-dist") });
  try {
    await server.listen({ host: "127.0.0.1", port: 5173 });
    await page.goto("http://127.0.0.1:5173/");
    await expect(
      page.getByText("本地服务已连接", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "阅读学习", exact: true }).click();
    const panel = page.locator(".reading-workspace");
    await expect(
      panel.getByRole("button", { name: "检查内置学习升级", exact: true }),
    ).toBeVisible();
    await expect(panel.getByLabel("材料原文", { exact: true })).toHaveCount(0);
    expect(store.module("learning").schemaVersion).toBe(1);
    await panel
      .getByRole("button", { name: "检查内置学习升级", exact: true })
      .click();
    const cards = panel.locator(".upgrade-card");
    await cards
      .filter({ hasText: "阅读学习" })
      .getByRole("button", { name: /确认升级/ })
      .click();
    await expect(panel).toContainText("备份");
    await cards
      .filter({ hasText: "阅读学习" })
      .getByRole("button", { name: /确认升级/ })
      .click();
    await expect(panel).toContainText("已经是当前版本");
    await cards
      .filter({ hasText: "英语 / 日语" })
      .getByRole("button", { name: /确认升级/ })
      .click();
    await expect(panel.getByLabel("材料原文", { exact: true })).toHaveCount(1);
    expect(store.module("learning").schemaVersion).toBe(2);
    expect(store.module("languages").schemaVersion).toBe(2);
    expect(store.get(original.id)!.body).toBe("旧版原文应保留。");
  } finally {
    await server.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test.describe("可选时间的夏令时安全", () => {
  test.use({ timezoneId: "America/New_York" });
  test("建议采纳遇到不存在或重复钟点必须明确修正，不能降级为未填写", async ({
    page,
  }) => {
    await openLearning(page);
    const goal = await seed(page, { title: "虚构纽约夏令时目标" });
    await openLearning(page);
    await page.getByRole("tab", { name: "依据与建议", exact: true }).click();
    const card = page
      .locator(".learning-workspace .advice-card")
      .filter({ hasText: goal.title });
    await expect(card).toHaveCount(1);
    await card.locator("summary").filter({ hasText: "采纳前调整待办" }).click();
    await card
      .getByLabel("建议待办标题", { exact: true })
      .fill("虚构纽约明确偏移待办");
    const picker = card.getByLabel("建议待办时间（可选）", { exact: true });
    await picker.fill("2030-03-10T02:30");
    await expect(card.getByRole("alert")).toContainText("不存在");
    await expect(picker).toHaveValue("2030-03-10T02:30");
    await card
      .getByRole("button", { name: "采纳为学习待办", exact: true })
      .click();
    expect(
      (await allEntities(page)).filter(
        (e) => e.title === "虚构纽约明确偏移待办",
      ),
    ).toHaveLength(0);
    await picker.fill("2030-11-03T01:30");
    await expect(card.getByRole("alert")).toContainText("重复");
    const offset = card.getByLabel("建议待办时间（可选） UTC偏移", {
      exact: true,
    });
    await expect(offset).toHaveValue("");
    await card
      .getByRole("button", { name: "采纳为学习待办", exact: true })
      .click();
    expect(
      (await allEntities(page)).filter(
        (e) => e.title === "虚构纽约明确偏移待办",
      ),
    ).toHaveLength(0);
    await offset.selectOption("-05:00");
    await expect(card.getByRole("alert")).toHaveCount(0);
    await card
      .getByRole("button", { name: "采纳为学习待办", exact: true })
      .click();
    await expect(
      page.getByText("建议已采纳为学习待办", { exact: false }).first(),
    ).toBeVisible();
    const tasks = (await allEntities(page)).filter(
      (e) => e.title === "虚构纽约明确偏移待办",
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0].fields.due).toBe("2030-11-03T01:30:00-05:00");
    expect(tasks[0].timeZone).toBe("America/New_York");
  });
});
