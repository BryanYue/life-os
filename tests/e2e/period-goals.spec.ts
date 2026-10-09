import { test, expect, type Page } from "@playwright/test";
import type { Entity, EntityInput } from "../../src/types.js";
import type { PeriodPlanDraft } from "../../src/period-planner.js";

async function seed(
  page: Page,
  input: Partial<EntityInput> & Pick<EntityInput, "module" | "type" | "title">,
) {
  const session = await (await page.request.get("/api/session")).json();
  const response = await page.request.post("/api/entities", {
    headers: { "x-csrf-token": session.csrf },
    data: {
      expectedVersion: 0,
      entity: {
        kind: "plan",
        status: "active",
        occurredAt: "2038-04-04",
        timeZone: "UTC",
        fields: {},
        relations: [],
        body: "虚构已有目标关联浏览器验证。\n",
        ...input,
      },
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as Entity;
}

async function openPlanner(page: Page) {
  await page.goto("/");
  await expect(page.getByText("本地服务已连接", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "时间规划", exact: true }).click();
  const planner = page.getByRole("region", { name: "高级周期规划" });
  await planner.getByLabel("周期开始日期").fill("2038-04-04");
  await planner.getByLabel("周期结束日期").fill("2038-04-05");
  await planner.getByLabel("周期时区").fill("UTC");
  await planner.getByLabel("窗口 1 开始").fill("09:00");
  await planner.getByLabel("窗口 1 结束").fill("09:40");
  return planner;
}

test("跨周周期通过真实领域目标选择并采纳 supports 关系，复盘等不可选", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("本地服务已连接", { exact: true })).toBeVisible();
  const targets: Entity[] = [];
  const targetInputs = [
    { module: "planning", type: "goal", title: "虚构关联生活目标" },
    {
      module: "planning",
      type: "direction",
      title: "虚构关联长期方向",
    },
    {
      module: "languages",
      type: "language-goal",
      title: "虚构关联日语目标",
      fields: { language: "日语" },
    },
    { module: "learning", type: "goal", title: "虚构关联阅读目标" },
  ];
  for (const entity of targetInputs) targets.push(await seed(page, entity));
  const excluded: Entity[] = [];
  const excludedInputs: (Partial<EntityInput> &
    Pick<EntityInput, "module" | "type" | "title">)[] = [
    {
      module: "planning",
      type: "review",
      title: "虚构不能作为目标的复盘",
    },
    {
      module: "health",
      type: "goal",
      title: "虚构已完成目标",
      status: "done",
    },
    {
      module: "quant",
      type: "goal",
      title: "虚构事实目标",
      kind: "fact",
    },
    {
      module: "projects",
      type: "goal",
      title: "虚构已删除目标",
      deleted: true,
    },
  ];
  for (const entity of excludedInputs) excluded.push(await seed(page, entity));
  const before = (await (
    await page.request.get("/api/entities?includeDeleted=1")
  ).json()) as Entity[];
  const planner = await openPlanner(page);
  for (const entity of excluded)
    await expect(
      planner
        .getByLabel("关联已有目标 1", { exact: true })
        .locator(`option[value="${entity.id}"]`),
    ).toHaveCount(0);
  for (let index = 0; index < targets.length; index++) {
    if (index)
      await planner
        .getByRole("button", { name: "＋ 添加周期目标", exact: true })
        .click();
    await planner
      .getByLabel(`关联已有目标 ${index + 1}`, { exact: true })
      .selectOption(targets[index].id);
    await expect(
      planner.getByLabel(`周期目标 ${index + 1}`, { exact: true }),
    ).toHaveValue(targets[index].title);
    await planner
      .getByLabel(`周期总分钟 ${index + 1}`, { exact: true })
      .fill("20");
  }
  const proposed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/plan/period" &&
      response.request().method() === "POST",
  );
  await planner
    .getByRole("button", { name: "生成周期规划建议", exact: true })
    .click();
  const draft = (await (await proposed).json()) as PeriodPlanDraft;
  expect(draft.input.goals.map((goal) => goal.id)).toEqual(
    targets.map((entity) => entity.id),
  );
  expect(draft.slots.map((slot) => slot.goalId)).toEqual(
    targets.map((entity) => entity.id),
  );
  expect(draft.slots.map((slot) => slot.date)).toEqual([
    "2038-04-04",
    "2038-04-04",
    "2038-04-05",
    "2038-04-05",
  ]);
  await expect(planner.locator(".period-result")).toContainText(
    "推进目标：虚构关联日语目标 · languages/language-goal",
  );
  const unaccepted = (await (
    await page.request.get("/api/entities?includeDeleted=1")
  ).json()) as Entity[];
  expect(unaccepted.length).toBe(before.length);
  await planner
    .getByRole("button", { name: "确认并保存周期计划", exact: true })
    .click();
  await expect(
    planner.getByRole("button", { name: "✓ 周期规划已保存", exact: true }),
  ).toBeVisible();
  const entities = (await (
    await page.request.get("/api/entities?includeDeleted=1")
  ).json()) as Entity[];
  const actions = entities.filter(
    (entity) =>
      entity.module === "planning" &&
      entity.type === "action" &&
      targets.some((goal) => goal.title === entity.title),
  );
  expect(actions).toHaveLength(4);
  for (const target of targets) {
    const action = actions.find((entity) => entity.title === target.title)!;
    expect(action.relations).toEqual([{ type: "supports", target: target.id }]);
    expect(action.kind).toBe("plan");
    expect(entities.find((entity) => entity.id === target.id)!.version).toBe(1);
  }
  const session = await (await page.request.get("/api/session")).json();
  const retry = await page.request.post("/api/plan/period/accept", {
    headers: { "x-csrf-token": session.csrf },
    data: { draft },
  });
  expect(retry.ok(), await retry.text()).toBeTruthy();
  const retried = (await (
    await page.request.get("/api/entities?includeDeleted=1")
  ).json()) as Entity[];
  expect(retried.length).toBe(entities.length);
});

test("临时文本周期目标明确未关联，并采纳为独立行动", async ({ page }) => {
  const planner = await openPlanner(page);
  await expect(
    planner.getByLabel("关联已有目标 1", { exact: true }),
  ).toHaveValue("");
  await expect(planner).toContainText("临时文本目标仅保存行动，不关联已有目标");
  await planner
    .getByLabel("周期目标 1", { exact: true })
    .fill("虚构临时文本周期目标");
  await planner.getByLabel("周期总分钟 1", { exact: true }).fill("20");
  await planner
    .getByRole("button", { name: "生成周期规划建议", exact: true })
    .click();
  await expect(planner.locator(".period-result")).toContainText(
    "临时文本目标 · 不关联已有目标",
  );
  await planner
    .getByRole("button", { name: "确认并保存周期计划", exact: true })
    .click();
  await expect(
    planner.getByRole("button", { name: "✓ 周期规划已保存", exact: true }),
  ).toBeVisible();
  const entities = (await (
    await page.request.get("/api/entities")
  ).json()) as Entity[];
  const action = entities.find(
    (entity) =>
      entity.module === "planning" &&
      entity.type === "action" &&
      entity.title === "虚构临时文本周期目标",
  )!;
  expect(action.relations).toEqual([]);
  expect(action.body).toContain("临时文本目标，未关联已有目标实体");
});
