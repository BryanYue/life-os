import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { app } from "../src/server.js";
import type { Entity, EntityInput } from "../src/types.js";
const when = {
  occurredAt: "2030-04-01T18:00:00+08:00",
  timeZone: "Asia/Shanghai",
};
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "life-workspace-api-")),
    s = new Store(root),
    server = app(s, {
      agentToken: "synthetic-workspace-token",
      agentModules: ["learning", "languages"],
    });
  const host = { host: "localhost:4310" },
    auth = await server.inject({ url: "/api/session", headers: host }),
    headers = {
      ...host,
      cookie: String(auth.headers["set-cookie"]).split(";")[0],
      "x-csrf-token": auth.json().csrf,
    };
  const post = async <T = Entity>(
    url: string,
    payload: Record<string, unknown>,
  ) => {
    const r = await server.inject({ method: "POST", url, headers, payload });
    assert.equal(r.statusCode, 200, r.body);
    return r.json<T>();
  };
  const get = async <T>(url: string) => {
    const r = await server.inject({ url, headers });
    assert.equal(r.statusCode, 200, r.body);
    return r.json<T>();
  };
  const goal = async (module: string) =>
    post("/api/entities", {
      entity: {
        ...when,
        module,
        type: "goal",
        title: "Fictional " + module + " goal",
        kind: "plan",
        status: "active",
        fields: {},
        relations: [],
        body: "Synthetic local goal",
      } satisfies EntityInput,
      expectedVersion: 0,
    });
  return {
    s,
    server,
    headers,
    post,
    get,
    goal,
    async close() {
      await server.close();
      s.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("integrated HTTP workspace preserves original writing, records reading time once and runs checklist/reminder/review actions in a non-UTC time zone", async () => {
  const f = await fixture();
  try {
    const goals = await Promise.all([f.goal("projects"), f.goal("languages")]);
    const material = await f.post("/api/reading/materials", {
      ...when,
      operationId: "api-material",
      title: "Fictional technical reading",
      reference: "synthetic://workspace-text",
      sourceType: "技术文档",
      language: "英语",
      rights: "虚构样例",
      body: "A fictional learner tests one idea and writes down the evidence.",
    });
    const sessionRequest = {
      ...when,
      operationId: "api-reading",
      materialId: material.id,
      minutes: 30,
      goalIds: goals.map((g) => g.id),
      takeaway: "区分想法与证据",
    };
    const session = await f.post("/api/reading/sessions", sessionRequest);
    assert.equal(
      (await f.post("/api/reading/sessions", sessionRequest)).id,
      session.id,
    );
    const explanation = await f.post("/api/reading/explanations", {
      ...when,
      operationId: "api-explanation",
      materialId: material.id,
      sessionId: session.id,
      text: "人工提供的辅助解释，并非验证后的结论。",
    });
    assert.equal(explanation.kind, "inference");
    assert.equal(explanation.status, "draft");
    await f.post("/api/reading/vocabulary", {
      ...when,
      operationId: "api-vocabulary",
      materialId: material.id,
      sessionId: session.id,
      term: "evidence",
      meaning: "证据",
      context: "writes down the evidence",
    });
    const task = await f.post("/api/learning/tasks", {
      ...when,
      operationId: "api-task",
      title: "Read and explain the fictional idea",
      goalIds: goals.map((g) => g.id),
      materialId: material.id,
      due: "2030-04-01T19:00:00+08:00",
    });
    const reminder = await f.post("/api/learning/reminders", {
      ...when,
      operationId: "api-reminder",
      title: "应用内回看",
      remindAt: "2030-04-01T19:00:00+08:00",
      taskId: task.id,
    });
    const asOf = encodeURIComponent("2030-04-01T20:00:00+08:00");
    const due = await f.get<{
      reminders: { due: Entity[] };
      counts: { total: number };
    }>(`/api/reports/learning-tasks?asOf=${asOf}`);
    assert.equal(due.reminders.due.length, 1);
    assert.equal(due.counts.total, 1);
    const doneRequest = {
      ...when,
      operationId: "api-checkin",
      taskId: task.id,
      expectedVersion: task.version,
      outcome: "完成",
    };
    const done = await f.post<{ task: Entity; checkIn: Entity }>(
      "/api/learning/check-ins",
      doneRequest,
    );
    const repeated = await f.post<{ task: Entity; checkIn: Entity }>(
      "/api/learning/check-ins",
      doneRequest,
    );
    assert.equal(repeated.checkIn.id, done.checkIn.id);
    const undo = await f.post<{ task: Entity; checkIn: Entity }>(
      "/api/learning/check-ins",
      {
        ...when,
        operationId: "api-undo",
        taskId: task.id,
        expectedVersion: done.task.version,
        outcome: "撤销",
      },
    );
    assert.equal(undo.task.status, "active");
    assert.notEqual(undo.checkIn.id, done.checkIn.id);
    const snoozed = await f.post(
      `/api/learning/reminders/${reminder.id}/action`,
      {
        operationId: "api-snooze",
        expectedVersion: reminder.version,
        action: "snooze",
        remindAt: "2030-04-02T19:00:00+08:00",
      },
    );
    const acknowledged = await f.post(
      `/api/learning/reminders/${reminder.id}/action`,
      {
        operationId: "api-ack",
        expectedVersion: snoozed.version,
        action: "ack",
      },
    );
    assert.equal(acknowledged.status, "done");
    const original = "先自由思考：我还没有组织好，也不需要限制句子数。";
    const expression = await f.post("/api/expression/create", {
      ...when,
      operationId: "api-expression",
      title: "原创表达练习",
      mode: "口头文字记录",
      originalText: original,
      materialId: material.id,
      sessionId: session.id,
      goalIds: goals.map((g) => g.id),
    });
    const structured = {
      claim: "把观点与证据分开",
      groups: [
        {
          reason: "便于核对",
          evidence: [
            { text: "材料中的虚构学习记录", sourceId: material.id },
            { text: "辅助解释仅是推断", sourceId: explanation.id },
          ],
        },
      ],
    };
    const revised = await f.post("/api/expression/revise", {
      operationId: "api-revise",
      id: expression.id,
      expectedVersion: expression.version,
      expectedNoteHash: expression.noteHash,
      structure: structured,
      revisedText: "整理后保留观点、理由与证据，并明确未知。",
    });
    assert.equal(revised.body, original);
    const beforeCount = f.s.list().length;
    const feedback = await f.get<{
      kind: string;
      sourceChecks: { status: string }[];
      revisedDraft: { accepted: boolean };
    }>(`/api/expression/${expression.id}/feedback`);
    assert.equal(feedback.kind, "inference");
    assert.equal(feedback.revisedDraft.accepted, false);
    assert.ok(feedback.sourceChecks.some((s) => s.status === "inference"));
    assert.equal(f.s.list().length, beforeCount);
    const reading = await f.get<{
      uniqueTotalMinutes: number;
      byGoal: unknown[];
    }>("/api/reports/reading");
    assert.equal(reading.uniqueTotalMinutes, 30);
    assert.equal(reading.byGoal.length, 2);
    const summary = await f.get<{ minutesByLanguage: Record<string, number> }>(
      "/api/summary?module=languages",
    );
    assert.equal(summary.minutesByLanguage["英语"], 30);
    assert.equal(
      f.s.get(material.id)!.body,
      "A fictional learner tests one idea and writes down the evidence.",
    );
  } finally {
    await f.close();
  }
});
test("suggestions are read-only, explicit adoption creates a plan once, and agent credentials cannot use human learning commands", async () => {
  const f = await fixture();
  try {
    await f.goal("projects");
    await f.goal("quant");
    await f.goal("health");
    const before = f.s.list().length;
    const advice = await f.get<{
      asOf: string;
      days: number;
      suggestions: { id: string; goalIds: string[]; explanation: string }[];
    }>("/api/advice?asOf=" + encodeURIComponent("2030-04-02T12:00:00Z"));
    assert.equal(f.s.list().length, before);
    const candidate = advice.suggestions.find((s) => s.goalIds.length === 3)!;
    assert.ok(candidate);
    assert.match(candidate.explanation, /不等于未完成/);
    const request = {
      adviceId: candidate.id,
      asOf: advice.asOf,
      days: advice.days,
      operationId: "api-adopt",
    };
    const adopted = await f.post("/api/advice/adopt", request);
    assert.equal(adopted.kind, "plan");
    assert.equal(adopted.type, "checklist-item");
    assert.equal((await f.post("/api/advice/adopt", request)).id, adopted.id);
    const protectedPaths = [
      "/api/reading/materials",
      "/api/reading/sessions",
      "/api/learning/tasks",
      "/api/learning/check-ins",
      "/api/learning/reminders",
      "/api/advice/adopt",
      "/api/expression/create",
      "/api/expression/revise",
    ];
    const count = f.s.list().length;
    for (const url of protectedPaths) {
      const result = await f.server.inject({
        method: "POST",
        url,
        headers: {
          ...f.headers,
          authorization: "Bearer synthetic-workspace-token",
        },
        payload: {},
      });
      assert.equal(result.statusCode, 403, url);
    }
    assert.equal(f.s.list().length, count);
    assert.equal(
      (
        await f.get<{ suggestions: { id: string }[] }>(
          "/api/advice?asOf=" + encodeURIComponent("2030-04-02T12:00:00Z"),
        )
      ).suggestions.some((s) => s.id === candidate.id),
      false,
    );
  } finally {
    await f.close();
  }
});
