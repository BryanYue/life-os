import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { app } from "../src/server.js";
import type { Entity, EntityInput } from "../src/types.js";
import {
  compareExperiments,
  importResearchResult,
  parseResearchResult,
  type ResearchResult,
} from "../src/research.js";

const input = (
  module: string,
  type: string,
  fields: EntityInput["fields"],
  relations: EntityInput["relations"] = [],
): EntityInput => ({
  module,
  type,
  title: "虚构业务 · " + type,
  fields,
  relations,
  kind: "plan",
  status: "active",
  occurredAt: "2030-04-01",
  timeZone: "Asia/Tokyo",
  body: "全部为虚构测试资料，不含真实账户、仓库或敏感数据。",
});
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "life-domain-workflow-")),
    store = new Store(root),
    server = app(store);
  const session = await server.inject({
    url: "/api/session",
    headers: { host: "localhost:4310" },
  });
  const headers = {
    host: "localhost:4310",
    cookie: String(session.headers["set-cookie"]).split(";")[0],
    "x-csrf-token": session.json().csrf,
  };
  const create = async (entity: EntityInput) => {
    const response = await server.inject({
      method: "POST",
      url: "/api/entities",
      headers,
      payload: { entity, expectedVersion: 0 },
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json<Entity>();
  };
  return {
    root,
    store,
    server,
    headers,
    create,
    close: async () => {
      await server.close();
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("D04 public service: problem → learning → milestone → practice → two measured experiments → output → review survives restart", async () => {
  const f = await fixture();
  let initialStoreClosed = false;
  try {
    const project = await f.create(
      input("projects", "project", {
        problem: "虚构笔记助手不能区分引用与预测",
        evaluation: "12条合成样例中引用可追溯率≥90%",
      }),
    );
    const material = await f.create(
      input(
        "learning",
        "material",
        { progress: 50, author: "Fictional tutor" },
        [{ type: "supports", target: project.id }],
      ),
    );
    const learning = await f.create({
      ...input(
        "learning",
        "session",
        { minutes: 25, takeaway: "为合成引用增加稳定ID" },
        [
          { type: "related", target: material.id },
          { type: "supports", target: project.id },
        ],
      ),
      kind: "fact",
      status: "done",
    });
    const milestone = await f.create(
      input(
        "projects",
        "milestone",
        { deliverable: "交付含引用检查的本地原型" },
        [
          { type: "supports", target: project.id },
          { type: "evidence", target: learning.id },
        ],
      ),
    );
    const practice = await f.create({
      ...input(
        "projects",
        "task",
        { minutes: 45, output: "fixture://note-assistant/prototype" },
        [{ type: "supports", target: milestone.id }],
      ),
      kind: "fact",
      status: "done",
    });
    const predicted = await f.create({
      ...input(
        "projects",
        "experiment",
        {
          experimentVersion: "v2-prediction",
          codeRef: "fixture://code/v2",
          evaluation: "预计全部样例通过",
          result: "模型估计12/12；未测量",
        },
        [{ type: "related", target: project.id }],
      ),
      kind: "inference",
      status: "draft",
    });
    const measured = [];
    for (const [version, passed] of [
      ["v1", 8],
      ["v2", 11],
    ] as const) {
      measured.push(
        await f.create({
          ...input(
            "projects",
            "experiment",
            {
              experimentVersion: version,
              codeRef: "fixture://code/" + version,
              parameters: JSON.stringify({ citations: version === "v2" }),
              evaluation: "引用可追溯率",
              result: JSON.stringify({
                passed,
                total: 12,
                measuredOn: "synthetic-citation-fixture",
              }),
            },
            [
              { type: "related", target: project.id },
              { type: "evidence", target: practice.id },
            ],
          ),
          kind: "fact",
          status: "done",
        }),
      );
    }
    const output = await f.create({
      ...input(
        "learning",
        "output",
        { reference: "fixture://deliverables/citation-report" },
        [
          { type: "evidence", target: measured[1].id },
          { type: "supports", target: milestone.id },
        ],
      ),
      kind: "fact",
      status: "done",
    });
    const review = await f.create({
      ...input(
        "projects",
        "review",
        {
          period: "合成迭代",
          feeling: "v2实测11/12，与模型预计12/12分开",
          next: "复现唯一失败的引用样例",
        },
        [
          { type: "related", target: project.id },
          { type: "evidence", target: output.id },
          ...measured.map((e) => ({ type: "evidence", target: e.id })),
        ],
      ),
      kind: "fact",
      status: "done",
    });
    const response = await f.server.inject({
      url: "/api/entities",
      headers: f.headers,
    });
    const entities = response.json<Entity[]>(),
      compared = compareExperiments(
        entities,
        measured.map((e) => e.id),
      );
    assert.deepEqual(
      compared.experiments.map((e) => e.result),
      [
        { passed: 8, total: 12, measuredOn: "synthetic-citation-fixture" },
        { passed: 11, total: 12, measuredOn: "synthetic-citation-fixture" },
      ],
    );
    assert.ok(compared.differences.includes("codeRef"));
    assert.equal(
      compareExperiments(entities, [predicted.id, measured[1].id])
        .experiments[0].status,
      "inference",
    );
    // Traverse the actual saved relations to prove every stage is reachable.
    const reachable = new Set<string>();
    const visit = (id: string) => {
      if (reachable.has(id)) return;
      reachable.add(id);
      entities
        .find((e) => e.id === id)!
        .relations.forEach((r) => visit(r.target));
    };
    visit(review.id);
    for (const e of [
      project,
      material,
      learning,
      milestone,
      practice,
      ...measured,
      output,
    ])
      assert.ok(reachable.has(e.id), e.type);
    await f.server.close();
    f.store.close();
    initialStoreClosed = true;
    const reopened = new Store(f.root);
    try {
      assert.equal(
        reopened.get(review.id)!.fields.next,
        "复现唯一失败的引用样例",
      );
      assert.equal(reopened.get(predicted.id)!.kind, "inference");
      assert.deepEqual(
        compareExperiments(
          reopened.list(),
          measured.map((e) => e.id),
        ),
        compared,
      );
    } finally {
      reopened.close();
    }
  } finally {
    await f.server.close();
    if (!initialStoreClosed) f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("D05 public service: independent English/Japanese goal, material, practice and revision links to project/travel", async () => {
  const f = await fixture();
  try {
    const project = await f.create(
      input("projects", "project", {
        problem: "解释虚构本地助手原型",
        evaluation: "能给出英文演示",
      }),
    );
    const travel = await f.create(
      input("planning", "direction", {
        why: "虚构旅行准备，无考试和出行日期假设",
      }),
    );
    const goals: Entity[] = [],
      actuals: Entity[] = [],
      revisions: Entity[] = [];
    for (const [language, context, minutes] of [
      ["英语", project, 20],
      ["日语", travel, 35],
    ] as const) {
      const goal = await f.create(
        input(
          "languages",
          "language-goal",
          {
            language,
            measure: language === "英语" ? "介绍原型功能" : "理解虚构车站问路",
          },
          [{ type: "supports", target: context.id }],
        ),
      );
      goals.push(goal);
      const material = await f.create(
        input(
          "languages",
          "material",
          { language, reference: "fixture://" + language + "/dialogue" },
          [{ type: "supports", target: goal.id }],
        ),
      );
      const practice = await f.create({
        ...input(
          "languages",
          "practice",
          { language, skill: "说", minutes, context: context.id },
          [
            { type: "supports", target: goal.id },
            { type: "related", target: material.id },
            { type: "related", target: context.id },
          ],
        ),
        kind: "fact",
        status: "done",
      });
      actuals.push(practice);
      revisions.push(
        await f.create(
          input(
            "languages",
            "revision",
            { language, due: "2030-04-08", prompt: "重新练习刚才的合成对话" },
            [
              { type: "related", target: practice.id },
              { type: "supports", target: goal.id },
            ],
          ),
        ),
      );
    }
    const response = await f.server.inject({
      method: "POST",
      url: "/api/entities",
      headers: f.headers,
      payload: {
        entity: {
          ...goals[0],
          fields: { ...goals[0].fields, measure: "英文解释一条失败样例" },
        },
        expectedVersion: goals[0].version,
        expectedNoteHash: goals[0].noteHash,
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(f.store.get(goals[1].id), goals[1]);
    actuals.forEach((e) => assert.deepEqual(f.store.get(e.id), e));
    revisions.forEach((e) => assert.deepEqual(f.store.get(e.id), e));
    const totals = (
      await f.server.inject({
        url: "/api/summary?module=languages",
        headers: f.headers,
      })
    ).json();
    assert.deepEqual(totals.minutesByLanguage, { 英语: 20, 日语: 35 });
    assert.equal(f.store.get(goals[0].id)!.version, 2);
    assert.ok(!Object.hasOwn(goals[0].fields, "examDate"));
  } finally {
    await f.close();
  }
});

const research = (patch: Partial<ResearchResult> = {}): ResearchResult => ({
  format: "life-os-research-v1",
  id: "fictional-run",
  revision: "1",
  title: "虚构成本敏感性实验",
  hypothesis: "合成序列的参数变化改善费用后收益",
  experimentVersion: "v1",
  dataset: {
    version: "synthetic-v1",
    reference: "fixture://datasets/flat-series",
  },
  code: { reference: "fixture://code/commit-a" },
  parameters: { window: 3 },
  costs: {
    commissionBps: 5,
    slippageBps: 10,
    assumptions: "合成成本，不构成交易建议",
  },
  status: "not-run",
  result: null,
  occurredAt: "2030-04-01T10:00:00+09:00",
  timeZone: "Asia/Tokyo",
  ...patch,
});

test("D06 research adapter: unrun proposal, failed/success executions and dataset/code/parameters/cost differences", async () => {
  const f = await fixture();
  try {
    const dataset = await f.create({
      ...input("quant", "dataset", {
        datasetVersion: "synthetic-v1",
        reference: "fixture://datasets/flat-series",
      }),
      kind: "fact",
      status: "done",
    });
    const base = research({
      dataset: {
        version: "synthetic-v1",
        reference: "fixture://datasets/flat-series",
        entityId: dataset.id,
      },
    });
    const proposalResponse = await f.server.inject({
      method: "POST",
      url: "/api/import/research",
      headers: f.headers,
      payload: base,
    });
    assert.equal(proposalResponse.statusCode, 200, proposalResponse.body);
    const proposal = proposalResponse.json<Entity>();
    assert.equal(importResearchResult(f.store, base).id, proposal.id);
    assert.equal(proposal.kind, "plan");
    assert.equal(proposal.status, "draft");
    assert.equal(proposal.fields.result, "");
    const failureInput = {
      ...base,
      status: "failed" as const,
      result: { error: "synthetic fixture contains no validation partition" },
      proposalId: proposal.id,
    };
    const failed = importResearchResult(f.store, failureInput);
    assert.notEqual(failed.id, proposal.id);
    assert.equal(failed.kind, "fact");
    assert.equal(failed.status, "failed");
    assert.deepEqual(
      failed.relations.find((r) => r.type === "actual-of"),
      { type: "actual-of", target: proposal.id },
    );
    assert.equal(f.store.get(proposal.id)!.kind, "plan");
    const revisedDataset = await f.create({
      ...input("quant", "dataset", {
        datasetVersion: "synthetic-v2",
        reference: "fixture://datasets/partitioned-series",
      }),
      kind: "fact",
      status: "done",
    });
    const successInput = research({
      ...base,
      id: "fictional-run-v2",
      experimentVersion: "v2",
      dataset: {
        version: "synthetic-v2",
        reference: "fixture://datasets/partitioned-series",
        entityId: revisedDataset.id,
      },
      code: { reference: "fixture://code/commit-b" },
      parameters: { window: 5 },
      costs: { commissionBps: 8, slippageBps: 20 },
      status: "succeeded",
      result: { metrics: { netReturn: -0.02, maxDrawdown: 0.04 }, samples: 12 },
      proposalId: proposal.id,
    });
    // Exercise the native research route and its underlying source contract.
    const response = await f.server.inject({
      method: "POST",
      url: "/api/import/research",
      headers: f.headers,
      payload: successInput,
    });
    assert.equal(response.statusCode, 200, response.body);
    const success = response.json<Entity>();
    assert.equal(importResearchResult(f.store, successInput).id, success.id);
    const sourceReplay = await f.server.inject({
      method: "POST",
      url: "/api/import/source",
      headers: f.headers,
      payload: { entity: parseResearchResult(successInput) },
    });
    assert.equal(sourceReplay.statusCode, 200, sourceReplay.body);
    assert.equal(sourceReplay.json<Entity>().id, success.id);
    assert.equal(importResearchResult(f.store, failureInput).version, 1);
    const comparison = compareExperiments(f.store.list(), [
      proposal.id,
      failed.id,
      success.id,
    ]);
    const serviceComparison = await f.server.inject({
      url:
        "/api/research/compare?ids=" +
        [proposal.id, failed.id, success.id].join(","),
      headers: f.headers,
    });
    assert.equal(serviceComparison.statusCode, 200, serviceComparison.body);
    assert.deepEqual(serviceComparison.json(), comparison);
    assert.deepEqual(
      comparison.experiments.map((e) => e.status),
      ["not-run", "failed", "succeeded"],
    );
    for (const key of [
      "experimentVersion",
      "datasetVersion",
      "codeRef",
      "parameters",
      "costs",
      "result",
      "status",
    ])
      assert.ok(
        comparison.differences.includes(
          key as (typeof comparison.differences)[number],
        ),
        key,
      );
    assert.deepEqual(comparison.experiments[2].costs, {
      commissionBps: 8,
      slippageBps: 20,
    });
    assert.deepEqual(comparison.experiments[2].parameters, { window: 5 });
    assert.equal(comparison.experiments[0].result, null);
    assert.ok(
      comparison.experiments[2].relations.some(
        (r) => r.target === revisedDataset.id,
      ),
    );
    const corrected = importResearchResult(f.store, {
      ...successInput,
      revision: "2",
      result: { metrics: { netReturn: -0.03 } },
    });
    assert.equal(corrected.id, success.id);
    assert.equal(corrected.version, 2);
    assert.equal(importResearchResult(f.store, successInput).version, 2);
    assert.throws(
      () =>
        importResearchResult(f.store, {
          ...successInput,
          result: { unexpected: 1 },
        }),
      /new revision/,
    );
    assert.throws(
      () =>
        importResearchResult(f.store, {
          ...base,
          dataset: { ...base.dataset, version: "wrong" },
        }),
      /dataset identity/,
    );
    assert.throws(
      () => compareExperiments(f.store.list(), [failed.id, failed.id]),
      /distinct/,
    );
    assert.throws(
      () => compareExperiments(f.store.list(), [failed.id, dataset.id]),
      /unavailable/,
    );
    const count = f.store.list().length;
    assert.equal(
      (
        await f.server.inject({
          method: "POST",
          url: "/api/trade",
          headers: f.headers,
        })
      ).statusCode,
      404,
    );
    assert.equal(f.store.list().length, count);
    const invalid = await f.server.inject({
      method: "POST",
      url: "/api/import/research",
      headers: f.headers,
      payload: research({ result: { invented: true } }),
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(f.store.list().length, count);
  } finally {
    await f.close();
  }
});

test("research contract rejects malformed versions, non-JSON/unsafe values and invented unrun results", () => {
  for (const invalid of [
    research({ format: "unknown" as ResearchResult["format"] }),
    research({ status: "not-run", result: { returns: 1 } }),
    research({ status: "succeeded", result: null }),
    research({ status: "failed", result: {} }),
    research({ costs: { commissionBps: -1, slippageBps: 0 } }),
    research({ parameters: { window: Infinity } }),
    research({ parameters: JSON.parse('{"__proto__":{"pollute":true}}') }),
    research({ occurredAt: "2030-02-30" }),
    research({ timeZone: "Mars/Olympus" }),
  ])
    assert.throws(() => parseResearchResult(invalid));
  assert.equal({}.toString(), "[object Object]");
});
