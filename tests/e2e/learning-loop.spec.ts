import { test, expect, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import type { Entity } from "../../src/types.js";
import type { LearningLoopReport } from "../../src/learning-loop.js";
async function open(page: Page) {
  await page.goto("/");
  await expect(page.getByText("本地服务已连接", { exact: true })).toBeVisible();
  if (
    await page
      .getByRole("button", { name: "展开导航", exact: true })
      .isVisible()
  )
    await page.getByRole("button", { name: "展开导航", exact: true }).click();
  await page.getByRole("button", { name: "英语 / 日语", exact: true }).click();
  await page.getByRole("tab", { name: "量化学习闭环", exact: true }).click();
  const panel = page.locator(".learning-loop");
  if (
    await panel
      .getByRole("button", { name: "升级量化学习模块", exact: true })
      .isVisible()
  ) {
    await panel
      .getByRole("button", { name: "升级量化学习模块", exact: true })
      .click();
    await expect(
      panel.getByLabel("练习会话标题", { exact: true }),
    ).toBeVisible();
  }
  return panel;
}
async function report(page: Page) {
  return (await (
    await page.request.get("/api/learning-loop/report")
  ).json()) as LearningLoopReport;
}
async function post(page: Page, endpoint: string, payload: unknown) {
  const csrf = (await (await page.request.get("/api/session")).json()).csrf;
  const response = await page.request.post(endpoint, {
    headers: { "x-csrf-token": csrf },
    data: payload,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return await response.json();
}
async function setTime(page: Page, local: string) {
  const panel = page.locator(".learning-loop");
  await panel
    .getByLabel("闭环记录 IANA 时区", { exact: true })
    .fill("Asia/Shanghai");
  await panel
    .getByLabel("本次记录发生时间", { exact: true })
    .fill(local.slice(0, 16));
}
async function createSession(
  page: Page,
  title: string,
  minutes: string,
  date: string,
) {
  const panel = page.locator(".learning-loop");
  await setTime(page, date);
  await panel.getByLabel("练习会话标题", { exact: true }).fill(title);
  await panel.getByLabel("独立练习分钟", { exact: true }).fill(minutes);
  await panel
    .getByLabel("练习情境与方法", { exact: true })
    .fill("虚构学习材料；人工记录实际题目证据");
  await panel
    .getByRole("button", { name: "保存练习会话", exact: true })
    .click();
  await expect(panel.getByLabel("练习会话标题", { exact: true })).toHaveValue(
    "",
  );
}
async function fillAssessment(
  page: Page,
  title: string,
  sessionTitle: string,
  formId: string,
  itemId: string,
  phase: string,
  date: string,
) {
  const panel = page.locator(".learning-loop");
  await setTime(page, date);
  await panel.getByLabel("测评或题目记录标题", { exact: true }).fill(title);
  await panel
    .getByLabel("关联练习会话", { exact: true })
    .selectOption({ label: sessionTitle });
  await panel.getByLabel("测评阶段", { exact: true }).selectOption(phase);
  await panel.getByLabel("评测协议来源", { exact: true }).fill("e2e-synthetic");
  await panel
    .getByLabel("评测协议 ID", { exact: true })
    .fill("synthetic-reading-protocol");
  await panel.getByLabel("评测协议版本", { exact: true }).fill("1");
  await panel.getByLabel("测评难度", { exact: true }).fill("合成B1");
  await panel
    .getByLabel("测试条件（限时/辅助/环境）", { exact: true })
    .fill("限时15分钟；无辅助；安静房间");
  await panel.getByLabel("题卷来源", { exact: true }).fill("e2e-synthetic");
  await panel.getByLabel("题卷 ID", { exact: true }).fill(formId);
  await panel.getByLabel("题卷版本", { exact: true }).fill("1");
  await panel.getByLabel("题目 1 ID", { exact: true }).fill(itemId);
  await panel.getByLabel("题目 1 薄弱项标签", { exact: true }).fill("限定词");
  await panel.getByLabel("题目 1 实际答案", { exact: true }).fill("虚构答案A");
  await panel
    .getByLabel("题目 1 结果", { exact: true })
    .selectOption("incorrect");
  await panel.getByLabel("题目 1 错误类型", { exact: true }).fill("漏读限定词");
}

test("desktop structured loop: configurable 650/700, historical baseline, fresh retest, evidence and human adoption/withdrawal", async ({
  page,
}) => {
  const panel = await open(page),
    before = await report(page);
  const g = (await post(page, "/api/entities", {
    expectedVersion: 0,
    entity: {
      module: "languages",
      type: "language-goal",
      title: "虚构闭环个人目标",
      kind: "plan",
      status: "active",
      occurredAt: "2030-03-01T09:00:00+08:00",
      timeZone: "Asia/Shanghai",
      fields: { language: "en", measure: "保留原来的个人目标文本" },
      relations: [],
      body: "Synthetic only",
    },
  })) as Entity;
  await panel
    .getByRole("button", { name: "重新读取闭环记录", exact: true })
    .click();
  await panel.getByLabel("配置关联目标", { exact: true }).selectOption(g.id);
  await panel.getByLabel("量尺 ID", { exact: true }).fill("synthetic-points");
  await panel.getByLabel("量尺最小分", { exact: true }).fill("0");
  await panel.getByLabel("量尺最大分", { exact: true }).fill("990");
  await panel.getByLabel("个人目标分数", { exact: true }).fill("650");
  await panel
    .getByLabel("目标设定或变更理由", { exact: true })
    .fill("本人选择650");
  await panel
    .getByRole("button", { name: "追加目标配置", exact: true })
    .click();
  await expect(
    panel.getByLabel("目标设定或变更理由", { exact: true }),
  ).toHaveValue("");
  await panel.getByLabel("个人目标分数", { exact: true }).fill("700");
  await panel
    .getByLabel("目标设定或变更理由", { exact: true })
    .fill("人工改为700，保留旧配置");
  await panel
    .getByRole("button", { name: "追加目标配置", exact: true })
    .click();
  await expect(
    panel.getByLabel("目标设定或变更理由", { exact: true }),
  ).toHaveValue("");
  await createSession(page, "虚构闭环基线会话", "20", "2030-04-01T09:00:00");
  await fillAssessment(
    page,
    "虚构闭环基线测评",
    "虚构闭环基线会话",
    "e2e-form-a",
    "e2e-item-a",
    "baseline",
    "2030-04-01T09:00:00",
  );
  await panel
    .getByRole("button", { name: "保存测评与作答", exact: true })
    .click();
  await expect(
    panel.getByLabel("测评或题目记录标题", { exact: true }),
  ).toHaveValue("");
  await createSession(page, "虚构闭环复测会话", "25", "2030-04-08T09:00:00");
  await fillAssessment(
    page,
    "虚构闭环新题复测",
    "虚构闭环复测会话",
    "e2e-form-b",
    "e2e-item-b",
    "retest",
    "2030-04-08T09:00:00",
  );
  await panel
    .getByRole("button", { name: "保存测评与作答", exact: true })
    .click();
  await expect(
    panel.getByLabel("测评或题目记录标题", { exact: true }),
  ).toHaveValue("");
  const actual = await report(page),
    base = actual.assessments.find(
      (row) => row.entity.title === "虚构闭环基线测评",
    )!,
    retest = actual.assessments.find(
      (row) => row.entity.title === "虚构闭环新题复测",
    )!;
  expect(actual.uniqueTotalMinutes - before.uniqueTotalMinutes).toBe(45);
  expect(base.entity.occurredAt).toBe("2030-04-01T09:00:00+08:00");
  expect(
    actual.comparisons.find(
      (row) =>
        row.baselineId === base.entity.id && row.retestId === retest.entity.id,
    )?.comparable,
  ).toBe(true);
  await expect(
    panel.locator(".loop-comparison").filter({ hasText: "虚构闭环新题复测" }),
  ).toContainText("独立样本不足");
  expect(
    actual.configurations
      .filter((row) => row.data.goalId === g.id)
      .map((row) => row.data.targetScore)
      .sort(),
  ).toEqual([650, 700]);
  await panel
    .getByRole("button", { name: "更正练习 · 虚构闭环复测会话", exact: true })
    .click();
  await panel.getByLabel("独立练习分钟", { exact: true }).fill("30");
  await panel
    .getByRole("button", { name: "保存练习更正", exact: true })
    .click();
  await expect(panel.getByLabel("练习会话标题", { exact: true })).toHaveValue(
    "",
  );
  expect(
    (await report(page)).uniqueTotalMinutes - before.uniqueTotalMinutes,
  ).toBe(50);
  await panel
    .locator("summary")
    .filter({ hasText: "人工方法调整与采纳历史" })
    .click();
  await panel
    .getByLabel("拟调整的方法", { exact: true })
    .fill("先圈出限定词再回答，人工候选方法");
  await panel
    .getByLabel("调整理由与证据解释", { exact: true })
    .fill("依据两次合成错项，尚未验证效果");
  await panel.getByLabel("方法依据 虚构闭环基线测评", { exact: true }).check();
  await panel
    .getByRole("button", { name: "保存方法建议", exact: true })
    .click();
  await expect(panel.getByLabel("拟调整的方法", { exact: true })).toHaveValue(
    "",
  );
  const methodRow = panel
    .locator("article.loop-record")
    .filter({ hasText: "先圈出限定词再回答" })
    .first();
  await methodRow
    .getByRole("button", { name: "人工采纳此方法", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "撤销此方法采纳", exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "撤销此方法采纳", exact: true })
    .click();
  await expect(
    panel.locator("article.loop-record").filter({ hasText: "已撤销" }),
  ).toContainText("先圈出限定词");
  await page.screenshot({
    path: "/tmp/life-os-evidence/a-loop-desktop.png",
    fullPage: true,
  });
});

test("mutation success followed by failed refresh retries the same operation without double duration", async ({
  page,
}) => {
  const panel = await open(page),
    before = await report(page);
  await panel
    .getByLabel("练习会话标题", { exact: true })
    .fill("虚构刷新失败会话");
  await panel.getByLabel("独立练习分钟", { exact: true }).fill("17");
  await panel
    .getByLabel("练习情境与方法", { exact: true })
    .fill("mutation 200 followed by failed refresh");
  let failRefresh = false,
    failed = false;
  await page.route("**/api/learning-loop/sessions", async (route) => {
    const response = await route.fetch();
    failRefresh = true;
    await route.fulfill({ response });
  });
  await page.route("**/api/entities?includeDeleted=1", async (route) => {
    if (failRefresh && !failed) {
      failed = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await panel
    .getByRole("button", { name: "保存练习会话", exact: true })
    .click();
  await expect(
    page
      .locator(".message.error")
      .filter({ hasText: /fetch|Network|Failed/i })
      .first(),
  ).toBeVisible();
  await expect(panel.getByLabel("练习会话标题", { exact: true })).toHaveValue(
    "虚构刷新失败会话",
  );
  await panel
    .getByRole("button", { name: "保存练习会话", exact: true })
    .click();
  await expect(panel.getByLabel("练习会话标题", { exact: true })).toHaveValue(
    "",
  );
  const actual = await report(page);
  expect(
    actual.sessions.filter((row) => row.entity.title === "虚构刷新失败会话"),
  ).toHaveLength(1);
  expect(actual.uniqueTotalMinutes - before.uniqueTotalMinutes).toBe(17);
  await page.unrouteAll({ behavior: "wait" });
});

test("one shared goal keeps independent English/Japanese configuration histories through language switching", async ({
  page,
}) => {
  const panel = await open(page);
  const g = (await post(page, "/api/entities", {
    expectedVersion: 0,
    entity: {
      module: "planning",
      type: "goal",
      title: "虚构双语言共享目标",
      kind: "plan",
      status: "active",
      occurredAt: "2030-03-01T09:00:00+08:00",
      timeZone: "Asia/Shanghai",
      fields: {},
      relations: [],
      body: "Synthetic only",
    },
  })) as Entity;
  await panel
    .getByRole("button", { name: "重新读取闭环记录", exact: true })
    .click();
  await panel.getByLabel("配置关联目标", { exact: true }).selectOption(g.id);
  await panel
    .getByLabel("量尺 ID", { exact: true })
    .fill("synthetic-multilingual-points");
  await panel.getByLabel("量尺最小分", { exact: true }).fill("0");
  await panel.getByLabel("量尺最大分", { exact: true }).fill("990");
  const configure = async (score: string, reason: string) => {
    await panel.getByLabel("个人目标分数", { exact: true }).fill(score);
    await panel.getByLabel("目标设定或变更理由", { exact: true }).fill(reason);
    await panel
      .getByRole("button", { name: "追加目标配置", exact: true })
      .click();
    await expect(
      panel.getByLabel("目标设定或变更理由", { exact: true }),
    ).toHaveValue("");
  };
  await configure("650", "双语英语根参数");
  await panel.getByLabel("闭环语言", { exact: true }).selectOption("ja");
  await configure("500", "双语日语根参数");
  await configure("550", "双语日语后继参数");
  await expect(panel.getByText(/双语英语根参数/)).not.toBeVisible();
  await expect(panel.getByText(/当前.*双语日语后继参数/)).toBeVisible();
  await panel.getByLabel("闭环语言", { exact: true }).selectOption("en");
  await configure("700", "双语英语后继参数");
  await expect(panel.getByText(/双语日语后继参数/)).not.toBeVisible();
  await expect(panel.getByText(/当前.*双语英语后继参数/)).toBeVisible();
  const configs = (await report(page)).configurations.filter(
    (row) => row.data.goalId === g.id,
  );
  expect(configs).toHaveLength(4);
  expect(configs.filter((row) => row.current)).toHaveLength(2);
  for (const language of ["en", "ja"]) {
    const chain = configs
      .filter((row) => row.entity.fields.language === language)
      .sort((a, b) => a.data.revision - b.data.revision);
    expect(chain.map((row) => row.data.revision)).toEqual([1, 2]);
    expect(chain[1].data.previousId).toBe(chain[0].entity.id);
    expect(chain[0].current).toBe(false);
    expect(chain[1].current).toBe(true);
  }
});
test.describe("mobile teacher import and recovery", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    timezoneId: "Asia/Shanghai",
  });
  test("file contract, human correction, duplicate replay, preserved original and explicit recycle restore", async ({
    page,
  }) => {
    const panel = await open(page),
      before = await report(page);
    await createSession(page, "虚构手机教师会话", "12", "2030-04-02T18:30:00");
    const s = (await report(page)).sessions.find(
      (row) => row.entity.title === "虚构手机教师会话",
    )!.entity;
    await panel
      .locator("summary")
      .filter({ hasText: "教师分身摘要 · 手工或文件导入" })
      .click();
    const contract = {
      protocol: "life-os-teacher-summary-v1",
      source: {
        namespace: "e2e-mobile-teacher",
        id: "teacher-contract",
        revision: 1,
      },
      language: "en",
      occurredAt: "2030-04-02T18:30:00+08:00",
      timeZone: "Asia/Shanghai",
      originalText: "虚构聊天原文\n<script>window.loopUnsafe = true</script>",
      summary: "人工摘要，未经评分",
      modality: "chat-transcript",
      recommendations: ["回看限定词"],
      sessionIds: [s.id],
      goalIds: [],
    };
    await panel
      .getByLabel("教师契约 JSON 文件", { exact: true })
      .setInputFiles({
        name: "synthetic-teacher.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(contract)),
      });
    await expect(
      panel.getByLabel("教师契约 JSON", { exact: true }),
    ).toHaveValue(JSON.stringify(contract));
    await panel
      .getByRole("button", { name: "导入教师契约 JSON", exact: true })
      .click();
    await expect(
      panel
        .locator("article.loop-record")
        .filter({ hasText: "教师摘要 · teacher-contract" }),
    ).toContainText("人工摘要，未经评分");
    await panel
      .getByRole("button", {
        name: "更正教师摘要 · 教师摘要 · teacher-contract",
        exact: true,
      })
      .click();
    await panel
      .getByLabel("更正后的教师摘要", { exact: true })
      .fill("后来人工更正稿，保留原文");
    await panel
      .getByRole("button", { name: "保存教师摘要更正", exact: true })
      .click();
    await expect(
      panel.getByLabel("更正后的教师摘要", { exact: true }),
    ).not.toBeVisible();
    await panel
      .getByRole("button", { name: "导入教师契约 JSON", exact: true })
      .click();
    const imported = (await report(page)).teacherSummaries.find(
      (row) => row.data.contract.source.namespace === "e2e-mobile-teacher",
    )!;
    expect(imported.data.summary).toBe("后来人工更正稿，保留原文");
    expect(
      imported.revisions.some((row) => row.summary === "人工摘要，未经评分"),
    ).toBe(true);
    await panel
      .locator("summary")
      .filter({ hasText: "查看教师原文与修订历史" })
      .click();
    await expect(
      panel.getByText(contract.originalText, { exact: true }).first(),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => (window as unknown as Record<string, unknown>).loopUnsafe,
      ),
    ).toBeUndefined();
    await panel
      .getByRole("button", { name: "删除练习 · 虚构手机教师会话", exact: true })
      .click();
    expect(
      (await report(page)).uniqueTotalMinutes - before.uniqueTotalMinutes,
    ).toBe(0);
    await panel.locator("summary").filter({ hasText: "闭环回收站" }).click();
    const restoreSession = panel.getByRole("button", {
      name: "恢复闭环记录 · 虚构手机教师会话",
      exact: true,
    });
    await expect(restoreSession).toBeVisible();
    await expect(panel.getByText(/关联记录 .* 当前不可用/)).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await panel
      .getByRole("button", {
        name: "恢复闭环记录 · 虚构手机教师会话",
        exact: true,
      })
      .click();
    await expect(restoreSession).not.toBeVisible();
    await expect(
      panel.getByRole("button", {
        name: "删除练习 · 虚构手机教师会话",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (await report(page)).uniqueTotalMinutes - before.uniqueTotalMinutes,
    ).toBe(12);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "/tmp/life-os-evidence/a-loop-mobile.png",
      fullPage: true,
    });
  });
});

test("failed loop report refresh retains form and operation identity until a successful retry", async ({
  page,
}) => {
  const panel = await open(page),
    before = await report(page),
    title = "虚构报告刷新失败会话";
  await panel.getByLabel("练习会话标题", { exact: true }).fill(title);
  await panel.getByLabel("独立练习分钟", { exact: true }).fill("17");
  await panel
    .getByLabel("练习情境与方法", { exact: true })
    .fill("Synthetic report refresh failure");
  let failReports = false;
  const operationIds: string[] = [];
  await page.route("**/api/learning-loop/sessions", async (route) => {
    operationIds.push(route.request().postDataJSON().operationId);
    const response = await route.fetch();
    failReports = true;
    await route.fulfill({ response });
  });
  await page.route("**/api/learning-loop/report", async (route) => {
    if (failReports) await route.abort("failed");
    else await route.continue();
  });
  const submit = panel.getByRole("button", {
    name: "保存练习会话",
    exact: true,
  });
  await submit.click();
  await expect(
    page
      .locator(".message.error")
      .filter({ hasText: /fetch|Network|Failed/i })
      .first(),
  ).toBeVisible();
  await expect(submit).toBeEnabled();
  await expect(panel.getByLabel("练习会话标题", { exact: true })).toHaveValue(
    title,
  );
  await expect(panel.getByLabel("独立练习分钟", { exact: true })).toHaveValue(
    "17",
  );
  await page.unroute("**/api/learning-loop/report");
  await submit.click();
  await expect(panel.getByLabel("练习会话标题", { exact: true })).toHaveValue(
    "",
  );
  expect(operationIds).toHaveLength(2);
  expect(operationIds[1]).toBe(operationIds[0]);
  const actual = await report(page);
  expect(
    actual.sessions.filter((row) => row.entity.title === title),
  ).toHaveLength(1);
  expect(actual.uniqueTotalMinutes - before.uniqueTotalMinutes).toBe(17);
  await page.unrouteAll({ behavior: "wait" });
});

test("protected teacher body startup error identifies the note and reachable recovery report", async ({
  page,
}) => {
  await open(page);
  await createSession(page, "虚构教师启动诊断", "9", "2030-04-04T18:30:00");
  const session = (await report(page)).sessions.find(
    (row) => row.entity.title === "虚构教师启动诊断",
  )!.entity;
  const contract = {
    protocol: "life-os-teacher-summary-v1",
    source: {
      namespace: "e2e-teacher-diagnostic",
      id: "diagnostic",
      revision: 1,
    },
    language: "en",
    occurredAt: "2030-04-04T18:30:00+08:00",
    timeZone: "Asia/Shanghai",
    originalText: "受保护的虚构原文",
    summary: "虚构摘要",
    modality: "chat-transcript",
    recommendations: [],
    sessionIds: [session.id],
    goalIds: [],
  };
  const teacher = (await post(page, "/api/learning-loop/teacher-import", {
    contract,
  })) as Entity;
  const linkResponse = await page.request.get(
    "/api/obsidian/notes/" + teacher.id,
  );
  expect(linkResponse.ok()).toBeTruthy();
  const link = await linkResponse.json();
  const path = new URL(link.openUri).searchParams.get("path")!;
  // Only this disposable e2e-server fixture may be edited, never a personal Vault.
  expect(path).toMatch(/\/life-e2e-[^/]+\/vault\//);
  const original = readFileSync(path, "utf8");
  try {
    writeFileSync(
      path,
      original.replace(contract.originalText, "外部虚构改写"),
    );
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "暂时无法读取本地空间", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toContainText(teacher.id);
    await expect(page.getByRole("alert")).toContainText("learning-loop report");
    await expect(
      page.getByRole("alert").getByRole("button", { name: "关闭", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "重新连接", exact: true }),
    ).toBeVisible();
    const damaged = await report(page);
    expect(
      damaged.issues.some(
        (issue) =>
          issue.entityId === teacher.id && issue.message.includes("原文"),
      ),
    ).toBeTruthy();
    expect(
      damaged.teacherSummaries.find((row) => row.entity.id === teacher.id)!.data
        .contract.originalText,
    ).toBe(contract.originalText);
    expect(readFileSync(path, "utf8")).toContain("外部虚构改写");
  } finally {
    writeFileSync(path, original);
  }
  await page.getByRole("button", { name: "重新连接", exact: true }).click();
  await expect(page.getByText("本地服务已连接", { exact: true })).toBeVisible();
  const repaired = await report(page);
  expect(
    repaired.issues.filter((issue) => issue.entityId === teacher.id),
  ).toEqual([]);
  expect(
    repaired.teacherSummaries.find((row) => row.entity.id === teacher.id)!
      .entity.version,
  ).toBe(teacher.version);
});
