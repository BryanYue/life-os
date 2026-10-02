import { test, expect, type Page } from "@playwright/test";
import type { Entity, EntityInput } from "../../src/types.js";
async function ready(page: Page) {
  await page.goto("/");
  await expect(page.getByText("本地服务已连接", { exact: true })).toBeVisible();
}
async function seed(
  page: Page,
  input: Partial<EntityInput> &
    Pick<EntityInput, "module" | "type" | "title" | "fields">,
) {
  const session: { csrf: string } = await (
    await page.request.get("/api/session")
  ).json();
  const response = await page.request.post("/api/entities", {
    headers: { "x-csrf-token": session.csrf },
    data: {
      expectedVersion: 0,
      entity: {
        kind: "fact",
        status: "done",
        occurredAt: "2035-04-01T12:00:00Z",
        timeZone: "UTC",
        relations: [],
        body: "虚构专项浏览器验证记录",
        ...input,
      },
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as Entity;
}

test("财务：原币快照、缺汇率、明确汇率折算和来源编辑", async ({ page }) => {
  await ready(page);
  const account = await seed(page, {
    module: "finance",
    type: "account",
    title: "虚构专项人民币账户",
    fields: { category: "现金", currency: "CNY" },
  });
  await seed(page, {
    module: "finance",
    type: "snapshot",
    title: "虚构专项人民币快照",
    fields: { amount: "1000.01", currency: "CNY", category: "资产" },
    relations: [{ type: "related", target: account.id }],
  });
  await page.reload();
  await page.getByRole("button", { name: "资产财务", exact: true }).click();
  const report = page.getByRole("region", { name: "财务报告" });
  await report.getByLabel("折算币种").fill("USD");
  await report.getByLabel("截至日期").fill("2035-04-02");
  await report.getByRole("button", { name: "查看财务报告" }).click();
  await expect(report).toContainText("折算不完整");
  await expect(report).toContainText("1000.01");
  await seed(page, {
    module: "finance",
    type: "rate",
    title: "虚构专项直接汇率",
    occurredAt: "2035-04-01T00:00:00Z",
    fields: {
      base: "CNY",
      quote: "USD",
      rate: "0.125",
      date: "2035-04-01",
      reference: "虚构手动报价证据",
    },
  });
  await page.reload();
  await page.getByRole("button", { name: "资产财务", exact: true }).click();
  await report.getByLabel("折算币种").fill("USD");
  await report.getByLabel("截至日期").fill("2035-04-02");
  await report.getByRole("button", { name: "查看财务报告" }).click();
  await expect(report).toContainText("折算合计 125.00125 USD");
  await report
    .getByRole("button", { name: "虚构专项直接汇率", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("汇率来源", { exact: true }),
  ).toHaveValue("虚构手动报价证据");
});

test("健康：主观与设备分别展示、计划完成对照、XML错误与手动导入", async ({
  page,
}) => {
  await ready(page);
  const plan = await seed(page, {
    module: "health",
    type: "session",
    title: "虚构专项健康计划",
    kind: "plan",
    status: "active",
    fields: { activity: "步行", minutes: 30, measurement: "主观自评" },
  });
  await seed(page, {
    module: "health",
    type: "session",
    title: "虚构专项完成步行",
    fields: { activity: "步行", minutes: 20, measurement: "设备测量" },
    relations: [{ type: "actual-of", target: plan.id }],
  });
  await seed(page, {
    module: "health",
    type: "session",
    title: "虚构专项进行中步行",
    status: "active",
    fields: { activity: "步行", minutes: 15, measurement: "主观自评" },
    relations: [{ type: "actual-of", target: plan.id }],
  });
  await page.reload();
  await page.getByRole("button", { name: "运动健康", exact: true }).click();
  const report = page.getByRole("region", { name: "健康报告" });
  await report.getByRole("button", { name: "查看健康报告" }).click();
  await expect(report).toContainText("主观自评");
  await expect(report).toContainText("设备测量");
  const card = report
    .locator(".report-card")
    .filter({ hasText: "虚构专项健康计划" });
  await expect(card).toContainText("已记录 2 次 · 已完成 1 次");
  await expect(card.locator("tbody tr")).toHaveText(
    /duration.*30.*35.*20.*-10/s,
  );
  await card
    .getByRole("button", { name: "虚构专项完成步行", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("分钟", { exact: true }),
  ).toHaveValue("20");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await report
    .locator("summary")
    .filter({ hasText: "手动导入 Apple Health XML" })
    .click();
  await report.getByLabel("导入时区").fill("UTC");
  await report.getByLabel("这些是虚构测试数据").check();
  await report
    .getByLabel("Apple Health XML 内容")
    .fill("<HealthData><Record></HealthData>");
  await report.getByRole("button", { name: "导入健康 XML" }).click();
  await expect(report.locator(".import-result")).toContainText("已导入 0 条");
  await expect(report.locator(".import-result")).toContainText("行");
  const xml =
    '<HealthData><Record type="HKQuantityTypeIdentifierStepCount" sourceName="Fictional E2E Watch" sourceVersion="1" unit="count" value="123" startDate="2035-04-03 12:00:00 +0000" endDate="2035-04-03 12:01:00 +0000" creationDate="2035-04-03 12:01:00 +0000" /></HealthData>';
  await report.getByLabel("Apple Health XML 内容").fill(xml);
  await report.getByRole("button", { name: "导入健康 XML" }).click();
  await expect(report.locator(".import-result")).toContainText("已导入 1 条");
  await report.getByRole("button", { name: "查看健康报告" }).click();
  await expect(report).toContainText("123 → 123");
});

test("跨周周期：空输入、用户日期窗口与目标、容量调整、采纳和事实复盘", async ({
  page,
}) => {
  await ready(page);
  await page.getByRole("button", { name: "时间规划", exact: true }).click();
  const planner = page.getByRole("region", { name: "高级周期规划" });
  await expect(planner.getByLabel("周期开始日期")).toHaveValue("");
  await planner.getByLabel("周期开始日期").fill("2038-04-04");
  await planner.getByLabel("周期结束日期").fill("2038-04-05");
  await planner.getByLabel("周期时区").fill("UTC");
  await planner.getByLabel("窗口 1 开始").fill("09:00");
  await planner.getByLabel("窗口 1 结束").fill("10:00");
  await planner
    .getByLabel("周期目标 1", { exact: true })
    .fill("虚构专项跨周阅读");
  await planner.getByLabel("周期总分钟 1", { exact: true }).fill("90");
  await planner.locator("summary").filter({ hasText: "逐日容量" }).click();
  await planner.getByLabel("2038-04-05 容量系数").fill("0.5");
  await planner.getByRole("button", { name: "生成周期规划建议" }).click();
  await expect(planner.locator(".period-result")).toContainText("2038-04-04");
  await expect(planner.locator(".period-result")).toContainText("2038-04-05");
  await expect(planner.locator(".period-result")).toContainText("0.5");
  await planner.getByRole("button", { name: "确认并保存周期计划" }).click();
  await expect(
    planner.getByRole("button", { name: "✓ 周期规划已保存" }),
  ).toBeVisible();
  const entities: Entity[] = await (
    await page.request.get("/api/entities")
  ).json();
  const action = entities.find(
    (entity) =>
      entity.module === "planning" && entity.title === "虚构专项跨周阅读",
  )!;
  expect(action.kind).toBe("plan");
  await seed(page, {
    module: "learning",
    type: "session",
    title: "虚构专项阅读实际",
    occurredAt: action.occurredAt,
    fields: { minutes: 10 },
    relations: [{ type: "actual-of", target: action.id }],
  });
  await page.reload();
  await page.getByRole("button", { name: "生活规划", exact: true }).click();
  const review = page.getByRole("region", { name: "周期复盘" });
  await review.getByLabel("复盘开始日期").fill("2038-04-04");
  await review.getByLabel("复盘结束日期").fill("2038-04-05");
  await review.getByRole("button", { name: "查看周期复盘" }).click();
  await expect(review).toContainText("虚构专项阅读实际");
  await review
    .getByRole("button", { name: "虚构专项阅读实际", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("分钟", { exact: true }),
  ).toHaveValue("10");
});

test("研究：手动文件与文本导入、版本成本结果对比和来源回链", async ({
  page,
}) => {
  await ready(page);
  await page.getByRole("button", { name: "量化研究", exact: true }).click();
  const panel = page.getByRole("region", { name: "实验研究工具" });
  await panel
    .locator("summary")
    .filter({ hasText: "手动导入研究结果" })
    .click();
  const research = {
    format: "life-os-research-v1",
    id: "fictional-specialist-run-a",
    revision: "1",
    title: "虚构专项研究A",
    hypothesis: "仅虚构测试",
    experimentVersion: "v1",
    dataset: { version: "fixture-v1", reference: "local-fictional-fixture" },
    code: { reference: "fictional-revision-1" },
    parameters: { lookback: 20 },
    costs: { commissionBps: 2, slippageBps: 3 },
    status: "succeeded",
    result: { sharpe: 1.25, drawdown: 0.15 },
    occurredAt: "2035-04-01T12:00:00Z",
    timeZone: "UTC",
  };
  await panel.locator('input[type="file"]').setInputFiles({
    name: "fictional-research.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(research)),
  });
  await panel.getByRole("button", { name: "导入研究记录" }).click();
  await expect(panel.locator(".import-result")).toContainText("虚构专项研究A");
  await panel.getByLabel("研究结果 JSON").fill(
    JSON.stringify({
      ...research,
      id: "fictional-specialist-run-b",
      title: "虚构专项研究B",
      experimentVersion: "v2",
      costs: { commissionBps: 5, slippageBps: 8 },
      result: { sharpe: 0.8, drawdown: 0.2 },
    }),
  );
  await panel.getByRole("button", { name: "导入研究记录" }).click();
  await expect(panel.locator(".import-result")).toContainText("虚构专项研究B");
  await panel
    .getByLabel("选择比较实验（至少两条）")
    .selectOption([
      { label: "虚构专项研究A · 事实" },
      { label: "虚构专项研究B · 事实" },
    ]);
  await panel.getByRole("button", { name: "比较实验指标" }).click();
  await expect(panel.locator("table")).toContainText("commissionBps");
  await expect(panel.locator("table")).toContainText("slippageBps");
  await expect(panel.locator("table")).toContainText("sharpe");
  await expect(panel.locator("table")).toContainText("1.25");
  await expect(panel.locator("table")).toContainText("0.8");
  await expect(panel.locator("table")).toContainText("有差异");
  await panel
    .locator("table")
    .getByRole("button", { name: "虚构专项研究A", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("实验版本", { exact: true }),
  ).toHaveValue("v1");
});

test("高级周期：DST错误不写入，明确地点交通产生可核对的保护时段", async ({
  page,
}) => {
  await ready(page);
  const before: Entity[] = await (
    await page.request.get("/api/entities")
  ).json();
  await page.getByRole("button", { name: "时间规划", exact: true }).click();
  const planner = page.getByRole("region", { name: "高级周期规划" });
  await planner.getByLabel("使用高级约束 JSON").check();
  const buffers = {
    meals: 0,
    commute: 0,
    preparation: 0,
    recovery: 0,
    sleep: 0,
  };
  await planner
    .getByLabel("高级周期约束 JSON")
    .fill(
      JSON.stringify({
        timeZone: "America/New_York",
        days: [
          {
            date: "2026-03-08",
            scenario: "normal",
            startMinute: 150,
            endMinute: 210,
            protected: [],
            buffers,
          },
        ],
        goals: [
          { id: "fictional-browser-dst", title: "虚构DST目标", minutes: 20 },
        ],
      }),
    );
  await planner.getByRole("button", { name: "生成周期规划建议" }).click();
  await expect(page.getByRole("alert")).toContainText("DST");
  await expect(planner.locator(".period-result")).toHaveCount(0);
  const after: Entity[] = await (
    await page.request.get("/api/entities")
  ).json();
  expect(after.length).toBe(before.length);
  await planner
    .getByLabel("高级周期约束 JSON")
    .fill(
      JSON.stringify({
        timeZone: "UTC",
        days: [
          {
            date: "2039-04-01",
            scenario: "normal",
            startMinute: 540,
            endMinute: 600,
            protected: [],
            buffers,
            startLocation: "虚构家",
            travel: [{ from: "虚构家", to: "虚构图书馆", minutes: 10 }],
          },
        ],
        goals: [
          {
            id: "fictional-browser-travel",
            title: "虚构地点阅读",
            minutes: 20,
            sessionMinutes: 20,
            location: "虚构图书馆",
          },
        ],
      }),
    );
  await planner.getByRole("button", { name: "生成周期规划建议" }).click();
  await expect(planner.locator(".period-result")).toContainText("虚构地点阅读");
  await expect(planner.locator(".plan-slot")).toContainText("09:10–09:30");
  await planner.locator(".period-result summary").click();
  await expect(planner.locator(".period-result")).toContainText(
    "虚构家 → 虚构图书馆（用户填写）",
  );
});
