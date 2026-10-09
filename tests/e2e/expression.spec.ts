import { test, expect, type Page } from "@playwright/test";
import type { Entity, EntityInput } from "../../src/types.js";

test.use({ timezoneId: "Asia/Shanghai" });

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
        occurredAt: "2037-03-01T10:00:00Z",
        timeZone: "UTC",
        relations: [],
        body: "仅用于虚构浏览器验证。",
        ...input,
      },
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as Entity;
}
async function entities(page: Page): Promise<Entity[]> {
  return await (await page.request.get("/api/entities")).json();
}

test("390px表达：自由原稿、四组理由、推断反馈、来源回链与丢失响应重试均不重复计时", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("本地服务已连接", { exact: true })).toBeVisible();
  const material = await seed(page, {
    module: "learning",
    type: "material",
    title: "虚构表达原始材料",
    fields: { reference: "local:fictional-expression", rights: "虚构样例" },
    body: "虚构材料：明确来源使讨论更容易回看。",
  });
  const learningGoal = await seed(page, {
    module: "learning",
    type: "goal",
    title: "虚构表达阅读目标",
    kind: "plan",
    status: "active",
    fields: {},
  });
  const projectGoal = await seed(page, {
    module: "projects",
    type: "goal",
    title: "虚构表达实践目标",
    kind: "plan",
    status: "active",
    fields: {},
  });
  const session = await seed(page, {
    module: "learning",
    type: "session",
    title: "虚构表达已有阅读",
    fields: { minutes: 12 },
    relations: [{ type: "related", target: material.id }],
  });
  const inference = await seed(page, {
    module: "learning",
    type: "note",
    title: "虚构表达待确认解释",
    kind: "inference",
    fields: { noteType: "辅助解释" },
    body: "这只是一条待确认的推断。",
  });
  const before = await entities(page);
  const beforeMinutes = before
    .filter((item) => item.module === "learning" && item.type === "session")
    .map((item) => ({ id: item.id, minutes: item.fields.minutes }));
  await page.reload();
  await page.getByRole("button", { name: "展开导航", exact: true }).click();
  await page.getByRole("button", { name: "阅读学习", exact: true }).click();
  await page.getByRole("tab", { name: "表达练习", exact: true }).click();
  const studio = page.locator("details.expression-studio");
  await studio.locator(":scope > summary").click();
  await studio.getByLabel("表达标题", { exact: true }).fill("虚构手机表达练习");
  await studio
    .getByLabel("练习方式", { exact: true })
    .selectOption("口头文字记录");
  const original =
    "这是未经整理的虚构口头文字记录。\n我想先留下想法，再确认依据。<script>window.expressionUnsafe = true</script>";
  await studio.getByLabel("自由原稿", { exact: true }).fill(original);
  await studio.locator("summary").filter({ hasText: "来源与关联" }).click();
  const occurredAt = studio.getByLabel("表达发生时间", { exact: true });
  await expect(occurredAt).toHaveAttribute("type", "datetime-local");
  await occurredAt.fill("2037-03-01T18:30");
  await expect(studio.locator(".expression-goals input:checked")).toHaveCount(
    0,
  );
  await studio.getByLabel("源材料", { exact: true }).selectOption(material.id);
  await studio
    .getByLabel("已有学习记录", { exact: true })
    .selectOption(session.id);
  await studio
    .getByLabel("阅读学习 · 虚构表达阅读目标", { exact: true })
    .check();
  await studio
    .getByLabel("AI / Agent 实践 · 虚构表达实践目标", { exact: true })
    .check();

  const createBodies: { operationId: string; originalText: string }[] = [];
  await page.route("**/api/expression/create", async (route) => {
    createBodies.push(route.request().postDataJSON());
    if (createBodies.length === 1) {
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      await route.abort("failed");
    } else await route.continue();
  });
  await studio.getByRole("button", { name: "保存原稿", exact: true }).click();
  await expect(studio.getByRole("alert")).toContainText("文本已保留");
  await expect(studio.getByLabel("自由原稿", { exact: true })).toHaveValue(
    original,
  );
  await studio
    .getByRole("button", { name: "重试保存（同一操作）", exact: true })
    .click();
  await expect(studio.getByRole("status")).toContainText("已保存第 1 版");
  expect(createBodies).toHaveLength(2);
  expect(createBodies[1]).toEqual(createBodies[0]);
  const firstSave = (await entities(page)).filter(
    (item) => item.title === "虚构手机表达练习",
  );
  expect(firstSave).toHaveLength(1);
  expect(firstSave[0].body).toBe(original);
  expect(firstSave[0].timeZone).toBe("Asia/Shanghai");
  expect(firstSave[0].occurredAt).toBe("2037-03-01T18:30:00+08:00");
  expect(firstSave[0].fields).not.toHaveProperty("minutes");
  expect(
    firstSave[0].relations
      .filter((item) => item.type === "supports")
      .map((item) => item.target)
      .sort(),
  ).toEqual([learningGoal.id, projectGoal.id].sort());

  await studio
    .locator("summary")
    .filter({ hasText: "整理观点、理由与依据" })
    .click();
  await studio
    .getByLabel("核心观点", { exact: true })
    .fill("来源和性质应清晰标注。");
  for (let group = 1; group <= 4; group++) {
    await studio
      .getByRole("button", { name: "添加理由组", exact: true })
      .click();
    await studio
      .getByLabel(`理由 ${group}`, { exact: true })
      .fill(`虚构理由 ${group}，分别回答不同问题。`);
  }
  await studio.getByRole("button", { name: "添加理由组", exact: true }).click();
  await studio
    .getByRole("button", { name: "删除理由组 5", exact: true })
    .click();
  await expect(studio.locator(".expression-reason-card")).toHaveCount(4);
  for (const [group, sourceId] of [
    [1, material.id],
    [2, inference.id],
    [3, learningGoal.id],
  ] as const) {
    await studio
      .getByRole("button", { name: `添加依据 · 理由组 ${group}`, exact: true })
      .click();
    await studio
      .getByLabel(`依据 ${group}.1`, { exact: true })
      .fill(`虚构依据 ${group}，性质需核对。`);
    await studio
      .getByLabel(`依据来源 ${group}.1`, { exact: true })
      .selectOption(sourceId);
    await studio
      .getByLabel(`引用位置 ${group}.1`, { exact: true })
      .fill(`虚构段落 ${group}`);
  }
  await studio
    .locator("summary")
    .filter({ hasText: "整理后文稿与原稿对照" })
    .click();
  await studio
    .getByLabel("整理后文稿", { exact: true })
    .fill("这是我主动整理的虚构文稿。");
  await studio
    .getByRole("button", { name: "保存整理版本", exact: true })
    .click();
  await expect(studio.getByRole("status")).toContainText("已保存第 2 版");
  await studio
    .getByRole("button", { name: "查看结构反馈", exact: true })
    .click();
  const feedback = studio.getByRole("region", {
    name: "表达结构反馈",
    exact: true,
  });
  await expect(feedback).toContainText("推断（inference）");
  await expect(
    feedback.locator(".expression-coverage").getByText("4", { exact: true }),
  ).toBeVisible();
  await expect(feedback).toContainText("这组尚未填写事实或例子");
  await expect(feedback).toContainText("不能写成已实测事实");
  await expect(feedback).toContainText("不能据此声称活动或结果已经发生");
  await feedback.locator("summary").filter({ hasText: "来源核对" }).click();
  await expect(feedback).toContainText("推断记录，不可当作已验证事实");
  await feedback
    .getByRole("button", { name: "虚构表达待确认解释", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("标题", { exact: true }),
  ).toHaveValue(inference.title);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await feedback.locator("summary").filter({ hasText: "整理草稿" }).click();
  await feedback
    .getByRole("button", { name: "将草稿放入整理区，待我审阅", exact: true })
    .click();
  expect(
    (await entities(page)).find((item) => item.id === firstSave[0].id)!.version,
  ).toBe(2);
  await expect(studio.getByLabel("自由原稿", { exact: true })).toHaveValue(
    original,
  );
  await expect(studio.getByLabel("整理后文稿", { exact: true })).toHaveValue(
    /来源和性质应清晰标注。/,
  );
  await studio
    .getByRole("button", { name: "保存整理版本", exact: true })
    .click();
  await expect(studio.getByRole("status")).toContainText("已保存第 3 版");
  await studio.locator("summary").filter({ hasText: "表达练习回顾" }).click();
  await studio
    .getByRole("button", { name: "查看表达回顾", exact: true })
    .click();
  const review = studio.locator('[aria-label="表达回顾结果"]');
  await expect(review).toContainText("推断（inference）");
  await review
    .locator("summary")
    .filter({ hasText: "虚构手机表达练习" })
    .click();
  await expect(review).toContainText(original);
  await expect(
    review
      .getByRole("button", { name: "虚构表达已有阅读", exact: true })
      .first(),
  ).toBeVisible();
  const after = await entities(page);
  expect(
    after
      .filter((item) => item.module === "learning" && item.type === "session")
      .map((item) => ({ id: item.id, minutes: item.fields.minutes })),
  ).toEqual(beforeMinutes);
  expect(after.find((item) => item.id === firstSave[0].id)!.body).toBe(
    original,
  );
  expect(
    await page.evaluate(() => Object.hasOwn(window, "expressionUnsafe")),
  ).toBe(false);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
});

test("桌面表达：未整理也能保存，自由原稿不自动产生目标或学习记录", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("本地服务已连接", { exact: true })).toBeVisible();
  const before = await entities(page);
  await page.getByRole("button", { name: "阅读学习", exact: true }).click();
  await page.getByRole("tab", { name: "表达练习", exact: true }).click();
  const studio = page.locator("details.expression-studio");
  await studio.locator(":scope > summary").click();
  await studio.getByLabel("表达标题", { exact: true }).fill("虚构桌面自由表达");
  await studio
    .getByLabel("自由原稿", { exact: true })
    .fill("暂不整理，先保留一个虚构想法。");
  await studio.getByRole("button", { name: "保存原稿", exact: true }).click();
  await expect(studio.getByRole("status")).toContainText("已保存第 1 版");
  const after = await entities(page);
  const added = after.filter(
    (item) => !before.some((previous) => previous.id === item.id),
  );
  expect(added).toHaveLength(1);
  expect(added[0].type).toBe("expression");
  expect(added[0].body).toBe("暂不整理，先保留一个虚构想法。");
  expect(added[0].relations).toEqual([]);
  expect(JSON.parse(String(added[0].fields.structure))).toEqual({
    claim: "",
    groups: [],
  });
  expect(added[0].fields).not.toHaveProperty("minutes");
});
