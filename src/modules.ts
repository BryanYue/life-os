import type { Field, EntityType, Module } from "./types.js";
export type { Module, Field } from "./types.js";
const f = (
  key: string,
  label: string,
  type: Field["type"] = "text",
  required = false,
  options?: string[],
): Field => ({ key, label, type, required, ...(options ? { options } : {}) });
const t = (id: string, name: string, ...fields: Field[]): EntityType => ({
  id,
  name,
  fields,
});
const minutes = f("minutes", "分钟", "number");
const review = t(
  "review",
  "复盘",
  f("period", "周期"),
  f("feeling", "感受"),
  f("next", "下一步"),
);
const goal = t("goal", "目标", f("horizon", "阶段"), f("measure", "完成标准"));
function module(id: string, name: string, types: EntityType[]): Module {
  return {
    id,
    name,
    version: "0.1.0",
    coreApi: 1,
    schemaVersion: 1,
    codeVisibility: "public",
    enabled: true,
    entityTypes: [goal, ...types, review],
    relations: [
      { id: "related", name: "关联", targetModules: ["*"] },
      { id: "supports", name: "推进目标", targetModules: ["*"] },
      { id: "actual-of", name: "对应计划", targetModules: ["*"] },
      { id: "evidence", name: "证据", targetModules: ["*"] },
    ],
    views: ["list", "timeline", "form"],
  };
}
export const builtins: Module[] = [
  module("planning", "生活规划", [
    t(
      "action",
      "行动",
      minutes,
      f("scenario", "情境", "select", false, ["普通", "加班", "疲劳"]),
      f("start", "开始分钟", "number"),
      f("end", "结束分钟", "number"),
    ),
    t(
      "constraint",
      "时间约束",
      f("start", "开始分钟", "number"),
      f("end", "结束分钟", "number"),
    ),
    t("direction", "长期方向", f("why", "缘由")),
  ]),
  module("health", "运动健康", [
    t(
      "session",
      "训练与恢复",
      f("activity", "活动", "text", true),
      minutes,
      f("effort", "主观疲劳 0–10", "number"),
      f("measurement", "记录方式", "select", true, ["主观自评", "设备测量"]),
      f("unit", "单位"),
      f("value", "数值", "number"),
    ),
    t(
      "metric",
      "指标",
      f("metric", "指标名", "text", true),
      f("value", "数值", "number", true),
      f("unit", "单位", "text", true),
      f("measurement", "来源方式", "select", true, ["主观自评", "设备测量"]),
    ),
  ]),
  module("learning", "阅读学习", [
    t(
      "material",
      "书籍与课程",
      f("author", "作者（可选）"),
      f("progress", "进度", "number"),
    ),
    t("session", "学习记录", minutes, f("takeaway", "收获")),
    t("note", "知识笔记", f("topic", "主题")),
    t("output", "学习输出", f("reference", "产出引用")),
  ]),
  module("projects", "AI / Agent 实践", [
    t(
      "project",
      "问题与项目",
      f("problem", "问题定义"),
      f("evaluation", "评价标准"),
    ),
    t("milestone", "里程碑", f("deliverable", "交付物")),
    t(
      "experiment",
      "实验",
      f("experimentVersion", "实验版本", "text", true),
      f("codeRef", "代码引用"),
      f("parameters", "参数 JSON"),
      f("evaluation", "评价"),
      f("result", "实际测试结果"),
    ),
    t("task", "实践任务", minutes, f("output", "产出引用")),
  ]),
  module("languages", "英语 / 日语", [
    t(
      "language-goal",
      "语言目标",
      f("language", "语言", "select", true, ["英语", "日语"]),
      f("measure", "目标"),
    ),
    t(
      "material",
      "语言材料",
      f("language", "语言", "select", true, ["英语", "日语"]),
      f("reference", "材料引用"),
    ),
    t(
      "practice",
      "语言练习",
      f("language", "语言", "select", true, ["英语", "日语"]),
      f("skill", "技能", "select", true, ["听", "说", "读", "写"]),
      minutes,
      f("context", "实际使用情境"),
    ),
    t(
      "revision",
      "复习项",
      f("language", "语言", "select", true, ["英语", "日语"]),
      f("due", "复习日期", "date"),
      f("prompt", "复习内容"),
    ),
  ]),
  module("quant", "量化研究", [
    t(
      "dataset",
      "研究数据集",
      f("datasetVersion", "数据版本", "text", true),
      f("reference", "来源引用", "text", true),
    ),
    t(
      "experiment",
      "研究实验",
      f("hypothesis", "假设", "text", true),
      f("experimentVersion", "实验版本", "text", true),
      f("datasetVersion", "数据版本", "text", true),
      f("codeRef", "代码版本", "text", true),
      f("parameters", "参数 JSON", "text", true),
      f("costs", "费用与滑点假设", "text", true),
      f("result", "回测结果"),
      f("risk", "局限与风险"),
    ),
  ]),
  module("finance", "资产财务", [
    t(
      "account",
      "账户分类",
      f("category", "类别", "text", true),
      f("currency", "币种", "text", true),
    ),
    t(
      "entry",
      "收支记录",
      f("amount", "精确金额", "decimal", true),
      f("currency", "币种", "text", true),
      f("category", "分类", "text", true),
    ),
    t(
      "snapshot",
      "资产负债快照",
      f("amount", "精确金额", "decimal", true),
      f("currency", "币种", "text", true),
      f("category", "资产或负债", "select", true, ["资产", "负债"]),
    ),
    t(
      "rate",
      "汇率记录",
      f("base", "原币种", "text", true),
      f("quote", "目标币种", "text", true),
      f("rate", "汇率", "decimal", true),
      f("reference", "汇率来源", "text", true),
      f("date", "汇率日期", "date", true),
    ),
  ]),
  module("family", "亲属关系", [
    t(
      "member",
      "家庭关系",
      f("relation", "关系标签", "text", true),
      f("minor", "未成年人", "select", true, ["否", "是"]),
    ),
    t(
      "occasion",
      "重要日期与约定",
      f("date", "日期", "date"),
      f("agreement", "约定"),
    ),
    t(
      "interaction",
      "互动与共同事项",
      f("activity", "共同事项"),
      f("followup", "后续行动"),
    ),
  ]),
];
export function validateModule(m: Module) {
  if (
    !m ||
    !/^([a-z][a-z0-9-]*\.)*[a-z][a-z0-9-]{1,40}$/.test(m.id) ||
    !m.name ||
    !/^\d+\.\d+\.\d+$/.test(m.version) ||
    m.coreApi !== 1 ||
    !Number.isSafeInteger(m.schemaVersion) ||
    m.schemaVersion < 1 ||
    !["public", "private"].includes(m.codeVisibility) ||
    typeof m.enabled !== "boolean" ||
    !Array.isArray(m.entityTypes) ||
    !m.entityTypes.length ||
    !Array.isArray(m.relations) ||
    !Array.isArray(m.views) ||
    m.views.some((x) => !["list", "timeline", "form"].includes(x))
  )
    throw Error("Invalid or incompatible module");
  const unique = (keys: string[]) => new Set(keys).size === keys.length;
  if (
    !unique(m.entityTypes.map((x) => x.id)) ||
    !unique(m.relations.map((x) => x.id))
  )
    throw Error("Duplicate module keys");
  for (const type of m.entityTypes) {
    if (
      !/^[a-z][a-z0-9-]*$/.test(type.id) ||
      !type.name ||
      !Array.isArray(type.fields) ||
      !unique(type.fields.map((x) => x.key))
    )
      throw Error("Invalid entity type");
    for (const f of type.fields)
      if (
        !/^[a-z][a-zA-Z0-9]*$/.test(f.key) ||
        !f.label ||
        !["text", "number", "select", "decimal", "date"].includes(f.type) ||
        (f.type === "select" &&
          (!Array.isArray(f.options) || !f.options.length))
      )
        throw Error("Invalid field");
  }
  for (const r of m.relations)
    if (
      !/^[a-z][a-z0-9-]*$/.test(r.id) ||
      !r.name ||
      !Array.isArray(r.targetModules) ||
      !r.targetModules.length ||
      (r.max !== undefined && (!Number.isSafeInteger(r.max) || r.max < 1))
    )
      throw Error("Invalid relation");
}
export function fieldsSchema(type: EntityType) {
  return {
    type: "object",
    additionalProperties: false,
    required: type.fields.filter((f) => f.required).map((f) => f.key),
    properties: Object.fromEntries(
      type.fields.map((f) => [
        f.key,
        f.type === "number"
          ? {
              type: "number",
              ...(f.min === undefined ? {} : { minimum: f.min }),
            }
          : f.type === "select"
            ? { type: "string", enum: f.options }
            : f.type === "decimal"
              ? {
                  type: "string",
                  pattern: "^-?(0|[1-9][0-9]*)(\\.[0-9]{1,8})?$",
                }
              : f.type === "date"
                ? { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }
                : {
                    type: "string",
                    maxLength: 20000,
                    ...(f.required ? { minLength: 1 } : {}),
                  },
      ]),
    ),
  };
}
