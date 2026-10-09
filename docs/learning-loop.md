# 语言量化学习闭环

本地流程为：结构化基线 → 多次实际练习/错项 → 新题复测 → 用户明确采纳方法调整。它复用八领域中的 `languages`、原有 `language-goal` 与 `practice`，可关联 `learning/session` 的阅读时长，未新建独立领域或数据库。表达原稿/整理稿、人工 advice 和阅读词汇流程保持原有职责。

## 显式升级与历史

浏览器学习工作区的“量化学习闭环”页或 `learning-loop upgrade` 显式升级语言模块；安装、启动、读取报告均不自动迁移。schema 2 先 2→3 扩展语言代码，再 3→4 增加闭环类型；每个阶段使用 Store 的独立事务、迁移日志和仓库外备份。两阶段不是联合事务。第二步失败会明确报告当前 schema，可重试，或停止所有写入者后用首阶段备份恢复至新的隔离目录。

升级追加 `learning-config`、`assessment`、`attempt`、`teacher-summary`、`method-adjustment`，在 `practice` 上追加可选 `learningData`，并标记 `learningLoopProtocol: 1`。保留既有清单、语言历史值、字段、启停状态和未知 Markdown frontmatter。自定义同名类型/字段先拒绝升级，不覆写；未升级的同名自定义记录继续原 CRUD。自定义 schema 4 不等于闭环已安装。

配置关联已有目标。650、700 或其他分数均由用户选择；配置修改追加新记录并保留 previousId/revision，禁止原位覆盖目标配置。旧 `language-goal.measure` 不被改写。候选时长/复测周期可选，20–30 分钟、1–4 周只是可输入的候选参数，不是默认计划或效果承诺。

同一目标的每种语言各有一条配置链：唯一 revision 1 根，后继必须引用同目标、同语言的前一版本并连续递增。删除记录仍占据历史链位置；恢复不会改变当前版本。通用保存、来源导入、同步和备份恢复同样校验链结构；并发产生第二个后继会明确拒绝且不落库，应保留输入、重新读取当前链再人工决定。报告遇到已有不合法链会列出问题，不把分叉同时标为当前配置。

## 作答、时长与比较

每次练习会话是一条已有 `practice` 类型的完成事实。独立会话拥有分钟；复用已有阅读会话时，`learningData.readingSessionId` 与 `evidence` 关联必须一致，本条不保存分钟。报告对全部有效阅读与语言练习的时长所有者取并集，同一阅读、多目标、测评和题目关联不会重复计时。更正使用当前 version 和 Markdown hash；删除时长所有者后不计时，恢复原记录后仍按原所有者去重。

阅读模块停用后不能建立新的计时关联，通用保存、来源导入和同步也执行此规则。原先已保存的阅读计时关联仍可更正、删除和明确恢复；一条普通 related 关系不等于已建立计时关联。显式同步初始化与备份恢复可保留停用模块的历史关系。

题目保存 `{source,id,version}`，题卷保存同样的稳定身份，并记录技能、题型/薄弱项标签、实际答案、结果、错误类型、目标关联和对应会话/测评。题目版本保留，但**来源 + 题目 ID** 是是否见过的身份：修订版本不会自动成为新题。已有作答的题目/题卷/会话身份不可改；答案和结果可按版本更正。错误身份应删除并新建，旧暴露历史仍保留。

首答按 Store 全部历史快照保全的最早实际作答时间判定，包含删除项、更正前版本和同步 base；后补录早先作答会改变首答归属，后来推迟日期或删除不能抹掉旧暴露。首答时间相同或历史不可解析时保守标重复/不确定，并明确不可比。

基线与复测必须同语言、成绩类别、评测协议/版本/来源、量尺与范围、题卷来源、难度、条件、评分样本数量和技能/题型构成；复测时间晚于基线、题卷身份不同，且全部复测题目历史未答，基线也不能包含重复作答。任一条件不满足，报告逐条解释不可比原因。成绩分 `official`、`mock`、`practice`；官方成绩仅保存人工报告分数和来源，不导入官方题目，不提供换分。分数可选，系统不会把正确率换成考试分数。

薄弱项带实际作答 ID、错误类型和重复次数。`samples` 是不同题目身份的独立评分样本数，`incorrect` 是错误作答次数（含重复），两者不是错误率的分母/分子。少于五个独立评分题目显示样本不足；五题仅是 UI 描述标记阈值，达到阈值仍不作统计显著性或学习效果推断。虚构流程走通不证明进步。

## 教师摘要导入契约

手工结构化表单和 JSON 文件使用 `life-os-teacher-summary-v1`；示例见 [合成教师契约](../examples/learning-loop-teacher.json)。文件内容是 contract 本身；HTTP/CLI 请求用 `{ "contract": <文件内容> }` 包装。

```json
{
  "protocol": "life-os-teacher-summary-v1",
  "source": {
    "namespace": "synthetic-teacher",
    "id": "summary-1",
    "revision": 1
  },
  "language": "en",
  "occurredAt": "2030-04-01T09:00:00+08:00",
  "timeZone": "Asia/Shanghai",
  "originalText": "虚构原文；无真实个人资料。",
  "summary": "人工摘要，尚未核实。",
  "modality": "chat-transcript",
  "recommendations": ["回看实际错项"],
  "sessionIds": [],
  "goalIds": []
}
```

source namespace/id 稳定，revision 为递增正整数。modality 为 `text`、`chat-transcript`、`human-audio-observation`；全部保存为未核实 draft inference。聊天转写不能成为发音评分；契约不接受 pronunciationScore 等字段。未知字段或协议明确拒绝且零写入，不静默裁剪。原文保存在 Markdown body 与完整 contract 中，所有修订均在 Store 历史可回看，人工仅更正当前摘要。

已知来源修订重放只验证原导入 digest 并返回当前记录，不覆盖后来人工稿、不回退到旧修订、不复活删除记录。新来源修订需核对当前记录并提交 expectedVersion/expectedNoteHash；浏览器勾选“已核对当前教师稿”后执行。发生冲突时保留文件/文字、重新读取、核对当前稿再勾选重试。删除后的新修订必须先明确恢复原记录。新修订保留安装方自定义字段和非来源拥有的关联；未知 frontmatter 经原 Store 合成机制保留。

同步中的新教师来源修订必须保留来源导入 operation 身份与 receipt，修订只能前进。普通人工编辑 operation 只能修改同来源修订的摘要；不能改原文契约或伪装成新来源修订。源修订在已有历史中的原文契约必须一致，receipt 与保留的来源导入 operation 摘要也须一致。合法来源修订、人工摘要编辑、已知旧修订重放、显式初始化和备份恢复分别验证，不把历史快照当成新修订写入。

教师来源新稿与本机人工摘要发生同步冲突时，可明确选择 incoming 接受来源新稿，或 local 保留本机完整稿。裁决只复用已验证的原来源 operation、receipt 和完整历史快照；同步回传必须具有同样证明，普通写入或伪造 resolves 字段不能改写原文或触发修订回退。local 可明确保留旧来源稿，并保留被拒新稿的原文和 receipt；当前已接受来源指向所选稿。裁决前未解决冲突可备份恢复；裁决后被拒 operation 仍归档，重复同步不能复活被拒稿或重新产生同一冲突。

## 人工调整与恢复

方法建议必须引用实际非计划记录，先保存为 inference/draft；“人工采纳此方法”另建 plan/active，并保留原建议与此前方法关联。撤销将已采纳计划标 failed，保留历史，不自动执行新练习、提醒、考试报名或外部工具。没有真实语音 API、实时老师、硬件权限或自动发音评分。

所有人工 HTTP 路由继承本机 session、CSRF、Host/Origin 与模块启停限制；Agent 凭据不能访问这些入口。JSON 在命令入口及 Store 共享层运行时校验，generic/source/sync 也不能绕过题目身份、目标配置及教师原文契约。旧未识别协议读取时显示单记录问题，原数据不被改写。

CLI（每次显式设置仓库外合成/私人数据目录，不使用仓库内数据库）：

```bash
LIFE_OS_HOME=/tmp/life-loop-demo npm run cli -- learning-loop status
LIFE_OS_HOME=/tmp/life-loop-demo npm run cli -- learning-loop upgrade
LIFE_OS_HOME=/tmp/life-loop-demo npm run cli -- learning-loop session /tmp/session-input.json
LIFE_OS_HOME=/tmp/life-loop-demo npm run cli -- learning-loop assessment /tmp/assessment-input.json
LIFE_OS_HOME=/tmp/life-loop-demo npm run cli -- learning-loop teacher-import /tmp/teacher-request.json
LIFE_OS_HOME=/tmp/life-loop-demo npm run cli -- learning-loop report
```

命令还支持 configure、attempts、method、method-action、teacher-edit。普通学习写入命令要求稳定 operationId；教师来源导入改用 contract.source 的 namespace/id/revision 作稳定身份。若响应或写入后的刷新丢失，保留同一输入和幂等身份重试。浏览器完整刷新成功后才释放重试键。发生 Markdown pending 冲突时沿用现有 note recovery 与备份恢复命令，不建立第二套存储。

如果在 Obsidian 或文本编辑器中直接改了教师 `.md` 的受保护正文，刷新（包括启动读取）、`conflicts`、同步导出及备份会拒绝该变更，可能报 “Teacher original text must match the preserved contract”。这种外部修改不会成为受保护的教师来源修订，原文件、原文历史和 receipt 均保留。先把修改后的整个文件另存到 Vault 外作为副本，再从闭环报告的 `contract.originalText` 或既有来源修订历史取回原文，用文本编辑器仅恢复同一 `.md` 正文，保留 frontmatter 和文件位置；保存后重新读取冲突并备份。没有 pending note 时 `recover-note ... pending` 不适用于此场景。若确需更新原文，应在恢复后通过教师导入入口提交经审核的新来源修订。准备 Obsidian 打开链接时会提示这一限制。正文损坏时，网页可能尚未进入学习闭环就读取失败；启动错误会指出受影响笔记 ID。请对服务使用的同一数据目录执行上述 `learning-loop report` CLI 命令，或在已认证的本机会话读取 `GET /api/learning-loop/report`，获得受保护的 `contract.originalText` 及诊断。网页报告本身在这一失败状态下不可达，不能依赖它完成恢复。

教师 `contract.source` 与来源 receipt 保存原始导入身份；实体 `source` 也用于记录当前人工摘要操作的幂等来源，因此人工修改后可不同于最初导入身份。原文、修订和来源收据仍由共享校验保护。

验收包含实际 HTTP、CLI、桌面/390px 浏览器，以及 Store close/reopen 与 backup/restore 的配置历史、教师原文/source receipts、题目最早时间证据、删除标记和幂等往返；合成数据与截图存于 `/tmp`。当前验收覆盖本地环境，不能代替 Mac 原生新候选复验、真实手机/语音或学习效果验证。
