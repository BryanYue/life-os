# LifeOS「交易与研究」实施计划

版本：双审修订版 1；日期：2026-10-05（Asia/Shanghai）。本文是完整、可跨环境传递的实施输入，不表示功能已经实现或获准接入真实数据。最终审查状态见同目录 `trading-research-review.md`。术语：规划阶段指2026-10-05的文档与审查工作；首轮指仅历史回测与研究记录的产品阶段；首版指新封装契约v1。P0–P6是后续获准的实现阶段，可以在隔离合成环境写代码、运行验证；规划阶段禁止实施的限制不延伸为禁止P0–P6开发。

## 1. 原始目标、基线与执行边界

用户原话（2026-10-04 19:16 UTC）：“嗯 你的建议很好,你安排下 按你的建议整体丰富下 完善下 这个plan , 先在项目 本地生成这个 plan 然后你安排 代理以及使用claude 插件 review 修改下 这个plan 没啥问题 ,再让云端 去跑 这个 plan”。

受保护要求：Trader 保留策略、数据、回测引擎；LifeOS 的独立“交易与研究”体验负责策略实验、历史回测结果、风险指标、交易研究日志、复盘、数据来源与版本；阅读学习只关联学习目标和心得。首轮仅历史回测与研究记录。八领域保留，朋友模块不做，不改变既有 module/type/kind/id 和关联身份。

- 本地代码事实基线：`feat/local-life-os @ e6056782b30e4873197f289881b781549eb3918d`，规划阶段开始工作树干净。
- Trader 本地只读基线以仓库外证据别名 `TRADER_BASELINE_LOCAL` 保存；真实仓库名、HEAD、内部路径与行号不进入云端/公开交接。原平台存在大量未提交用户文件，不能把HEAD当完整版本，也不能checkout、stash、格式化或修改。云端只依赖本文的中性文件契约与合成夹具，不依赖该真实标识。
- 原范围云端工作 `01a10809-0016-7525-8e39-1e19ef81d033` 已由父协调报告冻结候选 `dcaa738444579b7cc45c730b001cdf82ddcb19b6`，涵盖英语学习闭环、扫描修复与 Obsidian。父协调报告该候选265/265检查、41/41 Chromium通过，这是该云候选证据，本文未独立重跑。原范围Mac双审协调线程 `01a1080f-b034-74c9-9609-4f6dc44be018` 在隔离worktree审查，不覆盖本计划或切本地分支；若有修复先由父协调串行整合。本计划实际实施至少对齐dcaa候选，并以原范围review整合后的最终HEAD为准，重点重新核对语言/Obsidian接口；e605仅调查基线，不能作为最终唯一执行基线或回退目标。
- 当前规划任务 `01a1085a-927b-7362-97d7-268f1bc5490b` 只写此计划及审查证据；不改业务代码、不启动服务、不动运行目录、不提交、不推送、不派云端实施。唯一进度文件 `docs/tasks/local-v01/PROGRESS.md` 由父协调维护，审查者不得写入。
- 后续云端只使用公共代码和完全合成夹具；不需要访问 Mac、Trader 私有实现、个人 Vault、Application Support 或任何数据库。真实文件适配和真实导入须在后续本地明确选择来源及目标目录，不能从本计划推定授权。
- 非目标：策略研发/优化、启动回测、行情下载、联网数据提供商、付费数据、自动交易、券商连接/凭据、持仓账本、真实交易明细、绩效承诺、公网服务、自动同步私人研究。模拟交易和实盘属于未实施的后续阶段。

当前已验证的是代码阅读、既有报告的版本核对与契约推导。规划阶段没有执行 `npm run check`、`npm run test:e2e` 或 Trader 回测；历史通过数字不能作为规划阶段实施验收。

## 2. 现有事实与复用决定

以下行号绑定上述 LifeOS 基线，实施前按最终代码重新定位。

| 当前事实与证据 | 本计划决定 |
|---|---|
| `src/categories.ts:4` 已有八分类，`quant → research`；个人配置可改标签和归属 | 保留 `research` 分类 ID 与 `quant` 模块 ID。在 `quant` 专区呈现“交易与研究”，不新增第九领域，不把整个 research 分类下其他插件改成交易模块；保留用户自定义导航标签/排序 |
| `src/modules.ts:141` 中 quant 有 dataset、experiment，以及公用 goal/review | 扩展这些实体和已有复盘；新增一个必要的研究日志类型，不再建平行“trading”模块或策略数据库 |
| `src/modules.ts:161` finance 使用精确 decimal 记录账户分类、收支、快照、汇率 | 财务继续拥有真实资产/负债与现金收支；回测收益不写入 finance，不计入净资产；本阶段两者不自动同步 |
| `src/research.ts:6,79,183` 支持 `life-os-research-v1`，未运行为 plan，成功/失败为 fact | 保留 v1 入口/字段/来源身份及三态语义，新增明确版本的封装而非悄悄改变 v1 |
| `src/research.ts:167` 将 dataset.reference 放入 body；任意顶层字段不会自动保存 | 新封装的来源、修订链和口径必须显式映射到 schema 字段，不能仅留在预览或吞掉未知字段 |
| `src/store.ts:791` 按 namespace/source_id/revision 留收据；同修订同内容幂等，同修订异内容拒绝 | 复用 operations/imports/source_receipts；补充严格前驱和人工改动检查，不另建独立导入数据库 |
| `src/store.ts:230` 使用 BEGIN IMMEDIATE，SQLite 提交后通过 pending_notes 落 Markdown | 校验、来源 head、操作和收据同一数据库事务；文件写入失败按既有恢复日志处理，不声称跨 SQLite/Vault 天然原子 |
| `src/research.ts:215` 比较 2–20 个同领域实验，主要列差异；projects 也使用它 | 增加 quant 的可比性与单位展示；保留 projects 比较行为，不将量化必填项施加给 AI/Agent 实验 |
| `src/server.ts:385`、`src/cli.ts:234`、`web/SpecialistPanels.tsx:601` 已有 API/CLI/UI 研究导入及比较 | 扩展真实入口，UI 拆出 ResearchWorkspace 可减少大文件耦合；不并行建第二套存储/权限/路由框架 |
| `src/builtin-upgrades.ts:18` 当前仅学习/语言受支持；`Store.migrateModule` 逐一升 schema 并备份 | 增加已知 quant v1→v2 显式升级；禁止启动时自动迁移、自定义 manifest 静默覆盖或降级 |
| `tests/domain-workflows.test.ts:394`、`tests/e2e/specialist.spec.ts:212` 已有研究流程场景 | 原验收保留，新增能区分旧问题与正确行为的场景；规划阶段没有运行这些测试 |

Trader 来源抽查仅用于制定适配规格，不复制其私有源码到本仓库或 Claude。可复用评估线程 `01a10809-c418-715a-a95c-6091c51f5010` 的最终报告：历史两份成功 manifest/summary 身份及摘要哈希曾核验，历史运行不是规划阶段重跑。源码必要复核确认：

- 本地身份算法源（精确定位在仓外附录）：原生身份为 Python `json.dumps(sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)` UTF-8 的 SHA256。
- 本地产物管理源（精确定位在仓外附录）：原生 Objects 校验全部声明文件；本计划只读白名单摘要，不能宣称完整 Objects 校验。不要调用 Objects，它可能触发其他文件/依赖/目录行为。
- 本地回测摘要源（精确定位在仓外附录）：Backtrader 日线近似、规则声明、成本默认逻辑、生产代码指纹、指标生成。`total_return` 是比例；`max_drawdown` 是正值回撤幅度；`commission_total` 是金额。未知成本不能因为当前代码默认值而填 0 或 0.001。历史 `backtest_code_sha256` 不能替换为当前文件 hash 或 HEAD。
- 本地打包视图源（精确定位在仓外附录）：现有 ZIP 包含账户、订单、成交与轨迹，首轮不接收 ZIP、不扫描表格或行情。库存叠加、因子/训练/推理产物不属于首轮摘要适配。

## 3. 产品结构与用户流程

进入既有 `quant` 模块后显示“交易与研究”，提供五个轻量视图：实验、比较、日志与复盘、数据来源、导入。目标仍使用现有 goal。页面顶部常驻说明“历史研究记录，LifeOS 不运行回测或下单”，每个结果独立展示模式与证据范围。

1. **实验**：列表按研究主题/策略别名、运行日期、执行状态、数据性质筛选。策略仅为不含源码的 `strategyKey`/名称和假设，以同键分组实验；不另建引擎、策略部署或参数调优页面。详情显示假设、版本、参数、成本、数据区间、风险、指标、失败证据、来源、修订历史及可选关联。
2. **比较**：沿用 2–20 选择。并列展示内容始终可用；条件不一致/缺失时明确“不可直接比较”及逐项原因，不做自动优胜排序。区分合成/历史观测、近似精度、时间窗口、频率、市场/资产、数据版本、成本、基准与指标定义。负收益也可执行成功。
3. **日志与复盘**：量化 `journal` 为研究决策日志/历史回测交易解读，非真实成交账本。记录研究时点、论据、当时预期、观察结果、教训、下一步；关联实验，不导入账户/订单/成交表。复盘沿用 `quant/review`，人工评价不塞进受来源控制的结果。机器耗时不写学习分钟。
4. **数据来源**：复用 dataset。列表和实验详情同时可查看数据版本、脱敏逻辑引用、区间/市场/数据性质及核验范围。导入不自动创建dataset；既有dataset可在导入后通过本地关联动作指向实验，必须版本/引用精确匹配。该动作写dataset或独立journal/review，不改来源实验及payload；未关联也保留来源字段。
5. **导入**：文件/文本 → 严格解析 → 预览变更与缺证/拒绝原因 → 用户明确确认 → 结果/重试。显示当前目标工作区的非敏感名称，不回显私人绝对路径；成功跳到同一实体。取消预览不写业务记录。源端缺证不冒充 failed 实验，可下载脱敏诊断，默认只留浏览器内存。

未运行计划仍走现有 v1/普通表单，只有用户明确提出计划才是 not-run；保存的 Trader 定义不等于从未运行。首轮研究日志只使用手填的非敏感研究内容/合成演示，模拟账户与真实交易日记另立后续需求。

实现dataset/journal/review复用通用列表表单，专区只增加必要导航/详情/比较/导入组合；通用quant表单的researchMeta/source不可编辑，使用统一安全摘要渲染器，不原样展示JSON。比较抽共享组件，所有quant比较入口执行同一可比性。内置模块名继续“量化研究”，“交易与研究”仅专区标题，个人自定义标签保留。

界面必须覆盖空状态、加载、解析错误、证据缺失、权限/模块停用、冲突、重试、导入完成、浏览器刷新与手机窄屏。JSON 是导入/高级详情能力，常用指标和风险以明确中文标签展示；不以展开原始 JSON 代替可读结果。错误摘要不得含原文片段、账户号或服务器路径。

## 4. 契约版本与存储映射

### 4.1 兼容策略

保留 `life-os-research-v1` 原解析和已有 namespace `manual-research-v1`。新增外层 `trader-lifeos-export-v1`，内含原 v1 `record`，由新服务验证后映射；不支持的格式版本整体拒绝。这样既复用旧三态记录，也能严格承载研究来源和修订链。外层不是对 Trader 当前导出的事实描述，而是待实现的适配协议。

quant manifest 升为 schema 2：experiment 增加可选 `strategyKey`（text）、`researchMeta`（text，受控 JSON）；新增 `journal`，字段 `context`、`expectation`、`observation`、`lesson`、`next` 均 text，以及必填 `mode` select=`historical-research`。公用review结构保持不变；研究判断和依据写其feeling正文（明确标签“支持/不支持/尚不确定”），下一步写next。首版不增加结构化判断筛选，不原地修改八领域共享的review对象。旧 experiment 不新增必填字段，不填造历史来源；旧记录 UI 显示“来源/口径未声明”。日志 type 不包含金额、持仓和下单字段。

`fields.researchMeta` 保存固定 `{format:"lifeos-trader-meta-v1", envelope:完整已接受外层对象}`，保留每个可选字段的原始存在性，不能只存摘要而丢失重算 payloadDigest 所需数据；外层已严格白名单化，record 业务字段沿现有映射。每版来源 operation 的 metadata 是不可变导入证据，当前实体的 metadata 也禁止人工更改。`dataset.reference` 同时在 metadata 结构内保留，不仅依赖 body 文案。只接受 schema 2 上的封装导入；旧 v1 在 schema 1/2 均可用。新外层的参数/指标白名单、512 KiB限制及新增词法限制仅适用于新入口，不能施加给旧 v1 或 projects；旧 v1 的任意有限 JSON（如 window/netReturn/lookback/sharpe/drawdown）及原响应保持。结果 `result.metrics`、`result.units`、`result.definitions`、`result.limitations` 结构见下文。来源受管body 仅生成简短固定说明，不携带原始 manifest、错误栈、代码或源文件路径。

### 4.2 外层字段（全部可验证、未知字段拒绝）

| 字段 | 类型/规则 |
|---|---|
| `format` | 固定 `trader-lifeos-export-v1` |
| `adapterVersion` | 固定受支持语义版本首版 `1.0.0`；未知主版本拒绝 |
| `revision`、`previousRevision` | 安全正整数，首次为 1/null，之后必须 +1 且前驱相等；record.revision 必须是外层 revision 的无前导零十进制文本 |
| `previousPayloadDigest` | 首次 null；后续为前一版规范化 payload SHA256；防止同序号分叉 |
| `payloadDigest` | 对去掉本字段后的完整外层对象规范化 UTF-8 做 SHA256；小写 64 hex；由接收端重新计算 |
| `source.system` | 固定中性协议值 `trader/research-platform`（这是新适配协议，不改Trader） |
| `source.projectId`、`jobId`、`runId` | 非敏感稳定别名/ID；各 1–80 ASCII `[A-Za-z0-9._-]`；runId 可 null 并列明缺证，但 jobId 必填；不得由当前路径或文件 mtime 构造 |
| `source.strategyKey` | 匿名稳定主题键或 null，使用与 projectId 相同字符约束；非空时按(projectId,strategyKey)分组，experiment.strategyKey保存规范化组合键，为空则不分组；不由策略源码/私人名称推导 |
| `source.artifactId` | 成功为 64 hex；失败可 null，不虚构产物 |
| `source.sourceStatus` | `succeeded` 或 `failed`；必须与 record.status 同步；其他状态只诊断不导入 |
| `source.dataOrigin` | `synthetic`、`historical-observation`、`unknown`；unknown 可记录，强制不可比 |
| `source.executionMode` | 首版仅 `historical-backtest`；paper/live 显式拒绝 |
| `source.accuracy` | 首版仅 `approximate`；保留 limitations，不推断精确 |
| `source.evidence` | `{level, checks, gaps}`；level 为 `synthetic-fixture`、`source-declared` 或 `metadata-summary-verified`；不接受 `reproduced`/实盘核验声明 |
| `source.times` | `{startedAt, finishedAt, terminalRecordedAt, artifactCreatedAt}`；源输入各为带Z/offset的ISO时点或null；输出统一UTC、固定毫秒精度 `YYYY-MM-DDTHH:mm:ss.sssZ`，record.timeZone固定 `UTC`，未知写null；record.occurredAt 取可信 terminalRecordedAt，显示为终态记录时点；finishedAt 只有源端明确提供才填。job.updated_at 只能标为终态记录时间，created_at 不充当开始时间，mtime 不使用；无可信终态记录则待补证 |
| `source.code` | `{reference, scope, evidence}`，scope 固定中性值 `single-backtest-module`，reference 与 record.code.reference 一致；历史未知则待补证，禁止用当前代码代填 |
| `scope` | `{market, assetType, start, end, frequency, calendar, benchmark}`；未知值 null；日期是明确日历下的 YYYY-MM-DD 且 start≤end，frequency 首版 daily；benchmark 可 null，不能自动设大盘基准 |
| `costModel` | `{commissionBps, slippageBps, minimumCommission, sellTaxRate, currency, assumptions, completeness}`；金额为精确十进制字符串或 null；未知项标 null/partial，两个 bps 缺失不能进入 v1 记录，待补证；全部字段无任意扩展 |
| `record` | v1 必需字段，id 固定 `trader:<projectId>:job:<jobId>`，status 不允许 not-run；首版封装内relations必须缺省/空，dataset.entityId和proposalId禁止，避免本地ID混入跨端payload；关联由导入后独立实体持有，无自动学习时长；parameters/result 的键限首版声明白名单 |

`payloadDigest` 是内容一致性检验，不是数字签名或生产者身份认证。外层 evidence 是导出方声明，LifeOS 只能够重新核验包摘要、结构和内部一致性，UI 同时标出“本机导出工具声称已核验”与“LifeOS 已校验包”；不能因为有哈希显示“策略已验证”。

### 4.3 序列化与输入限制

- 首版 JSON 总 UTF-8 大小≤512 KiB；单 `researchMeta`、parameters、costs、result 规范化长度均≤20,000 字符（与当前字段上限协调，超限拒绝而非截断）；深度≤20；数组≤200项；对象≤200键；人类标题≤300字符，其余自由文本≤2,000字符。API在解析前限制大小，CLI先stat再有限读取；CLI/HTTP读取原始字节，浏览器File使用arrayBuffer，均以fatal UTF-8解码；禁止file.text/readFileSync utf8替换坏字节。HTTP确认将token置专用header、正文直接发原始JSON字节，512KiB按文件原始字节计；不修改全站 2 MB 上限来替代局部限制。
- 新封装 API/CLI/UI 的原始文本均经同一 strict parser，拒绝重复键、非法 Unicode、非有限数、超出安全整数的整数、危险原型键、未知结构键。不能先 JSON.parse 再“检查重复键”。请求体按独立文本字段/路由 raw body 处理，不能依赖 Fastify 默认解析已消除的信息。
- 外层规范化算法固定：对象 key 按 Unicode 标量排序；数组顺序保持；字符串按 JSON 规则 UTF-8、不 Unicode 归一化；数字限定有限 IEEE754，可用 ECMAScript JSON.stringify 表示，-0 归一 0；digest 不使用 localeCompare。规范函数只放 `src/research-contract.ts` 一处，以递归序列化直接按码点输出key，禁止排序后重建对象再JSON.stringify。冻结独立golden vectors：中文、组合字符、指数、1/1.0、-0、整数样式key 2/10、补充平面字符与U+E000混排、长度/安全整数边界；区分UTF-16字段字符限与UTF-8总字节限。采用明确实现，不依赖 Python 默认 dumps 与 JS 恰好相同。首版导出器在 LifeOS TypeScript 中生成外层，因此接收端使用同一规范函数，并以独立 golden 校验。
- Trader 原生 manifest 身份算法独立：严格复制其 Python canonical 的语义，不能用外层算法替代。优先本地纯 Python 标准库工具验证原生 manifest（不 import Trader），再把白名单中间对象交给 LifeOS 导出封装；两步之间的中间对象只在本机临时目录。若跨语言原生数字表示无法可靠保留，阻断 `metadata-summary-verified`，保留 source-declared/待补证，不伪造校验通过。云端用独立生成的原生合成 golden 测此算法。
- 金额不使用 JS number 累加；record 中 bps/ratio 按有限 number，展示只转换单位，不重新宣称风险计算；10000倍换算按4.5明确精度/边界测试。协议hash与Store sourceDigest是不同用途。仅新namespace的v2:receipt使用新canonical序列化固定受管投影+source身份的SHA256；不改变任何旧namespace的sourceDigest算法/已存摘要。新namespace在restore/bootstrap使用同一确定算法重算，不能依赖宿主locale。

### 4.4 成功、失败与指标

成功 result 的白名单指标：`total_return`（ratio，可负）、`max_drawdown`（非负幅度 ratio）、`fill_count`（非负整数）、`sessions`（正整数）；可选 `commission_total`（decimal-string，带 currency）、`final_equity`/`initial_cash`首版禁止输出以减少账户语义，不接额外指标。不存在的指标标缺失，不填 0。任意一项白名单指标加完整原生成功证据即可：只有total_return且身份/终态/数据/代码/成本证据完整时允许导入；只有收益数而无完整证据则待补证。缺少其他指标显示未提供，不自动补值。`units` 与 `definitions` 用稳定代码限定每项语义，limitations 为必读短文本数组。比率绝对范围不人为强塞 [-1,1]；超常值显示原值和风险，不通过“收益太高”改写执行状态。

失败 result 固定 `{failure:{stage,code,message,evidenceReference}, limitations}`，stage/code 是受支持枚举或 `unknown`，message 为脱敏≤1000字符；不允许成功 metrics、完整 traceback 或任意文件路径。失败任务可能无 manifest：要求显式任务身份、原生终态、真实终态时间、当次输入数据/代码/成本证据。缺项进入待补证诊断，不创建虚假失败实体；因子失败不能伪装回测失败。

`evaluation` 不由 execution status 推导。研究判断“支持/不支持/尚不确定”、评价依据与后续行动记录在独立 review；需要展示时按关联读取。不覆盖 Trader 原负面结论，不为了显示漂亮删失败/负收益样本。


### 4.5 P1 必须冻结的合成契约与原生映射

P1在业务实现前提交完整外层JSON Schema及“成功/失败/缺证”三组完全合成原生文件与预期封装；这是实施产物，不要求读取真实Trader。草案中的散文字段约束不能代替它。每条fixture测试独立重算hash，不能把64位占位符当已核验原生产物。冻结以下细节：

- evidence.level 为前述三值；checks 只允许 `manifest-identity`、`summary-bytes`、`job-artifact-link`、`definition-match`、`snapshot-link`、`code-reference`、`costs-explicit`、`timestamp-origin`；gaps 使用 `unverified-other-files`、`omitted-account-rules`、`private-text-removed`、`run-id-missing`、`data-origin-unknown`、`cost-model-partial` 等P1列明的枚举。新未知代码拒绝，诊断可保留非导入的缺项码。checks是导出方声明，LifeOS另列本端实际检查。
- code.evidence=`artifact-recorded|terminal-evidence|synthetic-fixture`；costModel.completeness=`complete|partial`。任何未导出的成本/账户规则使其partial且不可直接比较。failure.stage=`validation|data|execution|publication|unknown`；failure.code=`INVALID_INPUT|DATA_UNAVAILABLE|EXECUTION_ERROR|PUBLICATION_ERROR|UNKNOWN`，通用安全message由代码生成。evidenceReference只能是该项目/job的脱敏逻辑引用。
- units 固定：total_return=`ratio`、max_drawdown=`positive_magnitude_ratio`、fill_count/sessions=`count`、commission_total=`decimal_amount`；definitions固定为 `end-equity-over-initial-minus-one`、`positive-peak-to-trough-with-initial-floor`、`filled-order-row-count`、`account-ledger-row-count`、`reported-commission-sum`，各键对应其指标，不允许错配。不存在指标不得配单位冒充0。
- 强制相等：sourceStatus=record.status；source.code.reference=record.code.reference；record.occurredAt=times.terminalRecordedAt；record.dataset.version=已核实snapshot alias，reference=同一逻辑引用；record.id/project/job与来源键相等；record.revision与外层revision一致。costModel的bps必须与record.costs两项完全相等；parameters.commission_rate×10000与bps按固定十进制转换规则相符（P1用Decimal十进制移位×10000，bps最多8位小数、超过精度拒绝不默默舍入，再转安全有限number；比较以规范十进制文本相等，golden包括0.0003→3及0.00015→1.5，不用宽泛误差吞掉差异）。minimumCommission、sellTaxRate和slippage规则也不得与parameters矛盾。字段互相矛盾一律422，无优先级覆盖。由一个纯derive函数生成record的对应字段并集中比对，不在各入口重复实现；previousRevision保留为显式链证据并验证等于revision−1。
- 明确原生路径：`job.id`→jobId；`job.state`→sourceStatus；`job.request.kind`必须backtest；`job.request.definition`必须与manifest.identity.definition一致；`job.progress.run_id`及若存在的`job.progress.result.run_id`必须一致；`job.progress.result.backtest`=manifest.id；manifest.identity.kind=backtest；manifest.identity.snapshot_id→dataset版本；definition指纹→experimentVersion；manifest.identity.backtest_code_sha256→历史code引用；manifest.files中唯一summary.json的sha256→原始summary字节校验；job.progress.result中出现的同名摘要指标须与summary一致，未提供的不猜。
- `job.updated_at`在显式终态记录中→terminalRecordedAt（不是精确finishedAt）；manifest.created_at→artifactCreatedAt；job.created_at只说明创建，不映射startedAt。复用旧artifact允许artifactCreatedAt早于本job，不据此拒绝或冒称新计算。源时点无offset/时区证据则待补证，禁止自动套本机时区。
- 失败job无manifest时，必要数据/代码/成本/终态证据使用单独只读的 `trader-lifeos-terminal-evidence-v1` 合成/本机文件布局，由P1完整定义，字段为jobId、terminalRecordedAt、dataset、code、explicitCosts、failureStage/code及evidenceRefs；每项必须指向既有当次记录而非现在填的默认。适配器没有证据就输出缺项，不让用户填一个“已验证=true”放行。真实兼容由P7核查，云端只验证声明的合成布局。

合成golden组的确定生成规范：取虚构job `fixture-job-001`、run `fixture-run-001`、project `synthetic-trader`、strategy `fixture-strategy`；signals/snapshot/code各用测试生成的固定内容SHA256；definition含engine=backtrader、明确snapshot_id/signals、start=2030-04-01、end=2030-04-30、rules={accuracy:approximate,commission_rate:0.001,minimum_commission:0,sell_tax_rate:0,slippage_bps:2}。summary使用total_return=-0.02、max_drawdown=0.04、fill_count=12、sessions=20，所有字段均声明为合成；先按原生Python canonical写summary并hash，再生成identity和manifest.id，再填job引用。外层revision=1、previous字段均null、dataOrigin=synthetic、evidence.level=synthetic-fixture；costs映射10/2bps；occurredAt与terminalRecordedAt同为2030-05-01T12:00:00.000Z，timeZone=UTC。最后按外层规范化算法计算payloadDigest，存一份完整期望JSON，与解析器实现独立比对。失败组换新job且result只有安全failure；缺证组删除成本/代码/时点以断言零导入。这里的生成规则是合成测试输入，不是已有Trader产物。

原生JSON的身份验证在Python保留其精确整数与浮点序列化语义；外层的JS安全整数/字段白名单限制只用于要导出的字段，不可在原生identity hash前删键或将未知数字round掉。超出安全/大小预算的输入拒绝核验，不降精度继续。源端定义或manifest中非输出字段仍参与原生身份计算但不跨本机中间对象传给云/Claude。

## 5. 本地只读适配流程与脱敏

实施分为可在云端完成的纯适配器与后续本机真实文件验收。首版接受显式选定的 job JSON、manifest JSON、summary JSON（失败可缺后两者并提供必要终态证据）；不访问 平台数据库、不递归发现目录，不导入 Trader 包，不执行策略/动态表达式，不启动线程池、回测或服务，无网络访问。

本机用户选择文件 → 只读校验身份链（job/definition/artifact/snapshot/code/times）及 summary 原始字节哈希 → 严格白名单选取 → 脱敏预览/缺项列表 → 生成单记录封装。任务与产物复用是两种身份：同产物被两个 job 引用也保留两个运行记录。

文件安全：拒绝符号链接（含父目录）、`..`/绝对路径的 manifest 文件条目、NUL、重复路径、硬链接异常、非普通文件；只允许 manifest 中精确 `summary.json`，不读取其他声明文件。从用户选定且已打开的目录 fd 开始，以 dir_fd 逐段 no-follow 打开子目录与最终文件；不能只 lstat 父目录后再按绝对路径 open。目录openat使用O_NOFOLLOW|O_DIRECTORY；文件使用O_RDONLY|O_NOFOLLOW|O_NONBLOCK，打开后立即fstat要求S_ISREG，FIFO/设备即刻拒绝避免阻塞。读取前后比较 fstat 身份/大小/mtime 并在同一已打开 fd 上 hash 与解析，变化则拒绝；UTF-8使用fatal/strict解码，不能先替换坏字节再JSON解析。目录文件关系和总大小受限，不能把字符串 startsWith 当 containment。云端测试使用临时目录注入换文件与路径逃逸反例。摘要核验输出必须明确“仅 identity＋summary，其他声明文件未校验”。

白名单可包括稳定匿名 ID、定义指纹、允许规则、时间、区间、市场类别、版本、摘要指标和限制；禁止原始标的集合/私有策略源码/信号表达式、账户名/编号/持仓/订单/成交表、凭据、URL 查询密钥、个人绝对路径、原始行情、模型权重与原始日志。错误和自由文本不能靠正则保证匿名：默认仅输出预定义安全错误代码和自写摘要，源端 message/title/name/risk、自由文本 limitations 不直接透传；限制先映射为审核过的通用规则说明，未知原文仅在本机待确认清单，不能将其静默丢失后标为完整；需本机预览确认的人工文字明确标记，不上传审查。

匿名alias映射位于用户显式 `--identity-config FILE` 指定的仓库外0600文件，由本机用户维护，记录schemaVersion、稳定projectId和本地项目绑定；adapt不得自动新建/随机重建，文件缺失/权限不符即拒绝。首次显式初始化仅在P7授权范围；配置自身包含私有定位，不进入封装。用户单独加密备份配置及前序封装，应用逻辑备份不含它们；恢复先校验映射，再恢复运行。提供上一版封装时必须核对projectId/jobId，alias变更拒绝。无上一版且无配置时无法证明同源，必须停止，不能声称所有alias丢失都能自动检出。原始 source ID/原生 hash 也可能泄露私有项目指纹：真实包默认只留本机，去掉姓名并不等于可公开。Claude/云端全部使用虚构 ID 和现场生成合成 hash，禁止上传真实运行摘要。

首版允许参数键仅为声明的回测规则：accuracy、commission_rate、minimum_commission、sell_tax_rate、slippage_bps；其他规则必须显式列为未导出/不可比，不把源中任意 nested definition 拷贝进 parameters。涉及标的映射的 lot_sizes、contract_multipliers、margin_rates 只保留“存在但未导出”的缺口，先避免私人集合泄露；不得因此声称精确复现或完整成本覆盖。

## 6. 幂等、修订、重放、并发和人工修改

封装使用新的保留 namespace `trader-lifeos-export-v1`，recordId=`trader:<projectId>:job:<jobId>:run`；不复用 v1 namespace，避免改变已有导入身份。已有 v1 实体不自动归并：预览提示可能同源但由用户以后单独确认，首版不做实体合并。

前驱链规则是新的导入服务契约，不能只在 UI/预览检查：

| 输入/当前状态 | 原子提交结果 |
|---|---|
| 新身份，revision=1，两个 previous 均 null | 创建一个 fact、operation、来源 receipt、head |
| 新身份却 revision>1 | `MISSING_PREDECESSOR`，拒绝跳过历史；从其他实例迁移须用既有备份/bootstrap，不能拿最新包冒充第一版 |
| 已见相同 revision + 相同规范 payload | 返回原 entity/current head、`replayed=true`，不增实体/版本/operation；即使它是旧修订也不倒退 |
| 相同 revision + 不同 payload | `REVISION_CONTENT_MISMATCH`，拒绝 |
| 未见修订但不是 currentRevision+1，或 previousRevision/digest 不等于当前 head | `REVISION_CONFLICT`，拒绝（包括首次到达的旧版） |
| 两个并发相同包 | 唯一一个提交，另一个返回同一实体；不能依赖前端按钮禁用 |
| 两个并发不同包声明同一前驱 | 首个提交，另一个冲突；不自动合并、不 last-write-wins |
| 当前实体已删除 | 相同历史包只返回 `deleted=true` 不复活；新修订拒绝 `SOURCE_DELETED`，恢复走显式既有恢复操作 |
| 当前受来源控制字段被手改/外部 Markdown 变化 | `LOCAL_EDIT_CONFLICT`，不覆盖；展示差异，可保留现状并把心得移至 review 后重新预览，无强制覆盖按钮 |
| 模块被停用、目标关联删除、schema变化、来源 head 改变 | 提交时重新验证并拒绝过期预览 |

来源 head/历史 payloadDigest 从本 namespace 对应的原始 source operation/value.researchMeta 推导和核对，复用 source_receipts 唯一性；不以当前可人工修改字段作为唯一信任根，不以字符串 revision 的词典排序判时序。若现有 source_receipts 不能存外层 digest，在新 metadata 保存并通过对应操作检索，不改旧收据算法。操作历史缺失/矛盾时阻断该来源并诊断，不能重建伪造前驱。

增加 Store 的有界 guarded-import 方法/选项：BEGIN IMMEDIATE 内依次验证权限/模块/schema、已见 receipt、当前 source head、严格前驱、managed projection、关联，再保存实体/operation/收据。不能在调用现有 importSource 外面先查后写，也不能套嵌 BEGIN。新入口不在提交前调用全局captureExternalNotes。先纯解析及只读预检，事务内直接读取目标Vault实时hash并与预览期望/note_index对应版本比较；不一致即LOCAL_EDIT_CONFLICT，不把刚变动的文件当作新base_hash。只处理目标的已知pending，其他实体持续冲突使新写入明确阻断，receipt/status仍可只读确认。不存在“pending_notes天然保护capture→write窗口”的保证。新路径必须受同一跨进程文件CAS/恢复协议保护。旧v1/通用importSource未capture的外部笔记覆盖窗口属于e605已知边界，P0核对前云修复情况；本计划不暗称已修或扩展为无关旧入口重写。

managed projection 明确包含 title、kind、status、occurredAt、timeZone、全部导入 fields、导入 relations、生成 body；与上次被接受 source operation 的投影作比较。创建/修订时间、entity.version、actor、schemaVersion 等系统元数据不计入 managed equality；迁移本身不应制造手改冲突。用户关联/笔记首版通过独立 journal/review 指向实验，不直接修改导入实体以免被修订覆盖。

预览产生无写入的可验证 token：绑定 payloadDigest、目标 entity/version/noteHash、当前 head、quant schema、相关实体版本与工作区身份，10 分钟有效；HMAC 使用服务进程内随机 secret，不持久化凭据，不在浏览器提供 secret。提交重新做完整验证，token 不是授权。重启 token 失效重新预览；如果前次提交实际完成但响应丢失，携带同包重试应先识别既有 receipt，再返回已完成结果，不能仅因 token 过期导致无法确认。CLI使用同一验证/提交服务，不依赖HTTP token；只保留 `research preview FILE` 与 `research import FILE --confirm`，不增加--dry-run别名。不带--confirm直接拒绝并提示preview。纯 adapt 必须在现有 CLI `new Store` 之前分流；preview/status 使用已有工作区的只读连接/文件观察器，禁止 mkdir/DDL/INSERT builtin、自动 flush 或 captureExternalNotes，不存在的目标保持不存在。HTTP preview 同样只观察，不为检查外部修改生成 operation。

新增受限提交原语明确区分commit前失败和commit后flush失败；guarded导入使用它，后者携带已提交结果返回notePending，不能用catch猜测是否提交。原普通transaction调用默认语义保留，其他写入者不因此悄悄降级。SQLite 成功而 Vault 写入失败：返回可区分的 `COMMITTED_NOTE_PENDING`（包含非敏感 entityId/operationId、可重试状态）；不谎称完整成功或回滚已提交 DB。pending 清理必须按本次观察的 `id + base_hash + markdown` 条件删除并检查影响行数，不能按 id 删掉其他进程新提交的日志；保留文件内容CAS，必要锁覆盖跨进程。使用两进程屏障复现旧行读取→新行提交→旧行清理，证明新日志保留。同包receipt只读判定必须在任何flush/capture之前执行，权限核验后返回既有结果；来源receipt保证零新增；持续外部冲突保留文件原文并要求人工处理。普通服务启动仍可被既有恢复冲突阻断，不伪称UI始终可用：增加只读 `research status FILE` 在 Store 自动恢复前查询同包 receipt/entity/operation/pending，能够确认DB已提交；CLI诊断给出既有 `recover-note <entityId> external|pending` 入口及二者数据效果，用户明确选择后恢复/重启，不自动选覆盖方式。HTTP请求期间发生待恢复时也返回可诊断receipt，后续写入拒绝。失败提交前不得产生 entity/receipt/audit 部分状态；预览不写业务 DB/Vault。

所有写入口（专用 HTTP、CLI、通用 `/api/import/source`、普通实体 save、sync/bootstrap/restore）必须遵守保留 namespace 的一致性验证，不能构造 researchMeta 绕过导入规则或伪造前驱。普通 save 可记录人工改动且之后导入应冲突，但不得随意改保留 source 身份/受保护链字段。来源证据校验静态import无循环依赖的纯 `research-contract` 模块，由Store/导入/sync共用，不建动态守卫注册表。在writeSnapshot、rememberSourceOperation与bootstrap/restore批量入库汇合点强制执行，再以入口冒烟核对agent建议、插件commit、patchFields、CLI migrate、note recovery等；外部输入不能自带“trusted”标记绕过守卫。跨副本并发同前驱不同子修订必须留下显式 conflict，不推进 head 或吞掉分支；既有旧 v1/其他 source 导入保持兼容。具体分支和兼容规则按下节实施，不能留为“实现时碰到再决定”的空白。


### 6.1 来源链传输与分叉的确定方案

不改DDL、表列集合或backup format1。新 namespace 的 source operationId 固定为 SHA256(canonical `[namespace,recordId,revision,payloadDigest]`)；旧来源的两种识别算法完全保留；新namespace不走v0.1收据修复循环、pipe式ID或无前缀/legacy摘要兼容，仅接受新含payload的operationID和现有v2格式完整性receipt，所有入口包括restore/bootstrap均拒绝其他形式。所有识别/收据重建/恢复分支仅在新 namespace 使用该算法，使同修订不同payload有不同操作ID。同包跨机器虽有不同本地时间/actor，仍按完整封装/受管投影确认幂等，不能用系统元数据差异制造伪分叉。

包含该 namespace 的增量同步和 bootstrap 使用新增 protocol=3，mode分别为 delta/bootstrap；不包含它的旧protocol1/2行为与字节语义保留。旧接收端明确拒绝3，禁止把含新来源的包降为旧协议。协议3沿用现有处理框架、scope和数据结构，在bootstrap增加 `researchEvidence: Operation[]`，携带每个纳入scope来源从revision1到accepted head的全部原始导入operation；不包含人工edit/migration操作，当前快照另传。增量按链顺序携带新来源操作；接收新source操作时禁止mergeSnapshots逐字段合并，必须以accepted原始投影核对本地受管字段与严格前驱，手改/删除/分叉则存显式conflict且不推进head，合法无关操作和cursor按既有conflict语义推进。完整来源历史、base/value和关系均须在同一授权scope，缺授权不能偷偷多传历史，改用只读字段投影或拒绝完整同步。UI不自动扩大分享范围。

bootstrap同一事务核对封装/操作ID/受管原始投影、连续前驱digest、唯一accepted分支、receipt绑定与imports head；将原始operation按历史证据插入现有operations表（本地seq由数据库分配，保留原op JSON身份），再安装当前快照、seen/receipts/head。不得重放历史快照覆盖当前手改/删除。基线快照操作不是来源证明。protocol3 的seen条目新增明确 `digestKind`：`research-payload-v1`＋payloadDigest 仅用于按6.1算法识别、经封装/受管投影验证且属于accepted来源历史的source operation；人工编辑、外部Markdown、migration、baseline及其他非source operation即使保留此namespace/envelope也用 `operation-json-v1`＋既有整操作摘要。researchEvidence与research-payload seen逐项匹配，非来源操作不能凭namespace或envelope存在性成为来源证明。识别新namespace时不得先用旧sync-seen的整operation摘要拒绝相同包，须比较封装/受管投影并保留本实例先接受的系统元数据。新seen元数据在meta中使用独立 `sync-seen-v3:` 前缀，restore/bootstrap继续验证并保留；这是既有meta表内的版本化收据，不是新增状态库。旧sync-seen算法和协议完全保留。重新bootstrap必须继续输出证据，故A→B→C后旧包确认、下一合法修订、手改冲突都成立。

对纳入完整bootstrap scope的来源，发送端只要存在未处置研究分叉就拒绝完整bootstrap，返回 `UNRESOLVED_RESEARCH_FORK`；不得只导出accepted链静默省略门槛。用户完成“保留当前、拒绝此分支”后才允许该来源bootstrap；拒绝分支继续留原副本及完整备份。只读投影仍可用，但明确不能作为可继续修订的完整副本。这一门槛仅作用于新namespace，不改变其他领域与旧协议。

链历史可能超过单记录/HTTP预算：protocol3包总原始字节仍≤现有2MB，researchEvidence≤500条，总深度/快照限按现有同步边界，超限以 `SOURCE_HISTORY_TOO_LARGE` 明确拒绝、不截断/不分母缩水。首轮无自动分片；完整备份恢复可保留更长历史。所有协议3导入先验证完整包再事务发布，无部分写入。同步能力是本地协议，不宣称已接真实云供应商。

离线分叉在accepted receipt/head更新前检测，拒绝分支存现有conflicts，ID由 source identity＋revision＋incoming payloadDigest 派生，重复收到零新增；不登记为accepted operation/receipt，不推进该来源head。与同包合法无关操作的处理沿现有“记录conflict但提交其他合法操作”模式，结构/权限错误仍整包拒绝。普通 `resolveConflict(local|incoming)` 对新来源分叉拒绝，防止其无条件rememberSourceOperation污染历史；首轮提供冲突查看与“保留当前，拒绝此分支”的明确动作，在原conflicts行保留被拒分支证据及 `researchDisposition=rejected`、处理时间与当前head摘要，重复输入返回既有处置，不删除行或登记accepted receipt；restore严格校验该扩展。未处置行才阻止后续修订。不得替换accepted同修订内容。这个动作不声称两份已分叉副本自动收敛。需选另一链作为权威时，保全两边后在新目录恢复所选完整备份，由父协调另行决定切换；不在规划阶段自动重写源身份或历史。尚未解决分叉的来源不能继续导入新修订。

研究conflict明确分类 `researchConflictKind=fork|local-edit`：accepted同修订异payload/竞争前驱属于fork；前驱合法而当前受管投影被人工修改或实体被删除属于local-edit，并以reason区分local-edited/source-deleted。被删除实体必须先经既有显式恢复；reset本身不得取消删除标记。缺前驱的增量包拒绝、不消耗cursor，不能伪归local-edit。reset只恢复本地投影，不自动接受任何远端操作。local-edit在reset之后允许用户显式“重试此修订”：不能先因op.id已在conflicts而跳过；再次完整guarded验证，只有原source操作成功提交后才标记原conflict为resolved并登记accepted operation/receipt，失败继续保留证据。仍以原op身份处理，不能随机生成ID消除冲突。fork绝不能经reset/retry进入accepted链，继续按保留当前/拒绝分支处理。完整bootstrap遇未解决local-edit返回 `UNRESOLVED_RESEARCH_CONFLICT`，避免丢失待重验输入；已解决local-edit历史留原副本/完整备份，accepted链按6.1传输。restore验证分类/处置与链的一致性。

### 6.2 入口职责（纯验证与状态转换分开）

| 入口 | 必须验证/允许效果 |
|---|---|
| 新封装parse/preview | 词法、封装摘要及内部一致性；只读观察base/文件，不创建Store或业务操作 |
| guarded import | 事务中前驱、accepted链、当前受管投影、关系和权限；唯一能以新包推进accepted head的本地入口 |
| build/save/saveMany/通用import | 同时看base及既有source绑定，禁止保留namespace的创建、移除、更换身份或metadata链字段篡改；允许保存普通手工字段变化，之后新导入必须报LOCAL_EDIT_CONFLICT |
| captureExternalNotes/recover-note/migration | 不冒充source operation；保留原始封装证据，只按既有语义记录人工/系统变化，触发后续managed equality检查 |
| rememberSourceOperation | 仅识别通过验证的新算法来源operation并登记accepted收据；conflict/rejected分支不进入此路径 |
| delta/bootstrap | 检查protocol3、全链/分叉、scope及当前实体绑定，不从任意当前快照制造来源证明 |
| conflict resolution | 新来源分叉只能按6.1有界处理；普通来源维持原行为 |
| backup/restore | 全表保留；历史source链校验独立于当前module schema，因此旧schema historical分支也必须校验，不只调用Store.validate；缺链/receipt矛盾拒绝发布恢复目录 |

共享验证器分别提供 envelope/chain、source binding/immutable metadata、managed projection三项职责。合法人工改动不要求当前业务字段等于原始envelope；新的来源修订在覆盖前才要求相等。备份保留的原始导入operation则始终须能从envelope重建其受管投影。


### 6.3 导出链、本地关联与人工恢复

离线adapt显式接收 `--previous-envelope FILE`；首次必须 `--initial`，两者互斥。上一包经同一严格解析/hash校验，项目/job必须匹配；相同业务输入、同adapterVersion得到完全相同包时原样输出以供重放；任何adapterVersion、补证、成本或其他payload内容改变都产生revision+1，previous字段由上一包派生。没有上一包不能猜最新head或擅自升版。封装可导出但尚未导入，故导出器不冒充接收端accepted状态：若上一包未被目标接受，导入仍报缺前驱。P7用户保管导出链，云端只测试合成文件。

重放唯一判据为(namespace,recordId,revision,payloadDigest)，Store sourceDigest只绑定映射的历史投影并核验存储一致性；不能用新正文模板/当前locale替代payload判定。新来源业务fields由新canonical直接序列化，不能调用旧parseResearchResult的canonical生成后再依赖不同locale的Store摘要；复用旧v1结构语义，不复用其历史序列化细节。新来源业务投影的字段规范化、固定body模板作为 `mappingVersion=1` 的代码常量冻结（写入researchMeta的format版本，不随UI文案变化）。旧v1的canonical、body模板与sourceDigest原值独立golden冻结，本次不统一替换旧canonical。

封装不带任何LifeOS本地实体ID。选择dataset/目标/心得时由已有dataset、goal或独立journal/review写关系指向实验；来源实验的relations首版为空，metadata完整保存源数据逻辑引用。跨域关联仍校验存在、权限与版本；不会因为不同接收工作区的本地绑定不同而改变payload或导入身份。

保留普通人工编辑能力，但researchMeta/source身份只读。提供明确的“还原到上次接受的来源修订”预览/确认动作（HTTP research/source-reset-preview、source-reset-confirm；CLI research reset-source ENTITY --preview/--confirm）。预览完整列出将还原的受管差异和保留的历史，确认绑定entity/version/实时noteHash/head，不接受任意客户端快照。事务先将本次已观察的外部正文作为普通人工版本保留，再以accepted source operation重建受管投影，写新的人工恢复operation/audit，不登记新source receipt、不改变accepted head、不删除历史。文件再次改变则拒绝，无强制覆盖。用户可先把心得复制到journal/review；取消零写入；确认后可重新预览并导入N+1。这不是分叉的incoming接受入口，未处置分叉仍按6.1阻断。

零写入观测集固定为entities、operations、audit、requests、imports、source_receipts、conflicts、pending_notes、note_index及Vault字节，不要求SQLite文件物理字节/WAL完全不变。解析拒绝、预览取消、预检/事务前失败不得改变该集合；不允许把无关capture写入排除分母。显式reset确认记录人工版本是该动作预期写入；sync已验证包中的业务分叉写conflict也是明确结果，均不称失败零写入。commit后note-pending另按已提交状态验收。

## 7. API、CLI 与权限

| 入口 | 输入/输出/边界 |
|---|---|
| `POST /api/research/import-preview` | raw JSON 文本；返回 normalized summary、changes、missingEvidence、warnings、payloadDigest、token，拒绝结构错误；无实体写入 |
| `POST /api/research/import-confirm` | 同一 raw JSON＋token；201 created，200 revised/replayed，202 note-pending；409 head/local edit/deleted conflict，422 invalid/unsupported/missing evidence，413 over limit；响应稳定 error code，不回显原文本 |
| `GET /api/research/compare` | 保留 ids 与原 response 字段，增加 quant `comparability`/reasonCodes 和显示单位；停用模块只能通过明确历史只读模式访问，不允许导入 |
| 现有 `/api/import/research`、CLI `import-research` | 原 v1 保持；封装必须先预览确认，不在旧入口隐式导入 |
| CLI `research preview FILE`、`research import FILE --confirm` | 相同 strict parser、规则及错误码，schema 旧版本报告需显式升级；不因 CLI 无浏览器绕过本地 edit/前驱/权限检查 |
| CLI `research adapt` | 本机显式 JSON 文件参数、输出新文件且不覆盖；只读源端、离线，无直接 DB 写入；stdout 不含原始敏感正文 |
| journal/review | 复用实体 API、版本/noteHash 检查与现有 relations；不另建授权模型 |

新路由使用typed error `{code,httpStatus,safeMessage}`，不依赖全局英文message正则：结构/内部不一致/缺证/SCHEMA_UNSUPPORTED为422；MISSING_PREDECESSOR、REVISION_CONTENT_MISMATCH、REVISION_CONFLICT、LOCAL_EDIT_CONFLICT、SOURCE_DELETED、未处置研究冲突为409；体积超限413；认证/权限401/403；未确认CLI请求拒绝无写入。意外错误统一安全message，不回显原异常。精确重放先于head顺序判断，但始终先校验权限和包。旧v1路由既有400行为保留。

沿用会话＋CSRF＋Host/Origin 检查。agent token 仍只能读/建议，不能触发研究导入/迁移；模块启用不表示外部执行许可。禁用 quant 保留实体/文件/收据和历史入口，新建/修订/导入拒绝。任何客户端传来的 `actor`、evidenceLevel、preview digest 不能成为权限凭据。验证状态由服务端用已验证原始source操作/receipt/当前投影推导为 verified-envelope、locally-modified、undeclared；不能读researchMeta字符串就给徽标。非保留namespace禁止新写researchMeta，既存同名自定义字段按undeclared不解释。该字段包含完整包，q搜索、投影、导出、bootstrap和sync遵循字段授权：隐藏metadata时researchMeta必须显式排除，不能因它是fields文本而泄漏；只读投影不能显示已验证链徽标或用于后续导入。停用模块新入口需显式历史只读参数，旧compare默认行为保留，新增拒绝只作用于写入。

导入首版一次一条记录，不引入批处理部分成功/队列；多条文件以后另定原子/分批语义。preview 的差异与正式提交使用同一规范数据；浏览器重新选文件或修改文本自动清空确认态。

## 8. 比较口径与风险呈现

每个实验固定展示四层：数据性质、运行方式、执行终态、证据核验范围，再显示近似精度与局限；它们不能互相推导。核验完整性不是研究质量，执行成功不是盈利。

可比性分为 `comparable`、`not-comparable`、`insufficient-metadata`；人工仍可并列查看，但不计算排名/最优建议。必须逐项一致：dataOrigin、executionMode、scope 的窗口/市场/资产/频率/calendar/benchmark、dataset version/reference、accuracy、关键 costModel、参数缺口和指标单位/定义。不同代码/实验版本允许作为对照变量并显著展示，不机械阻止所有策略对比；相同条件也不代表因果结论。

失败/未运行/旧 v1 无元数据只做过程/字段比较，不与成功指标混入统计。指标缺失显示“未提供”，不可比原因列表可展开，失败样本仍在筛选计数中，取消筛选可恢复。首版不计算 Sharpe/CAGR/VaR/置信区间，不从摘要擅自推导缺失指标，也不拉行情画伪净值曲线。

关联支持 quant goal/dataset/experiment/review/journal；可选跨域 supports→学习目标、related→心得/材料；目标必须存在、未删除、在当前读写权限内，dataset version/reference 精确一致，proposal 必须 quant experiment plan。跨域模块停用时保留既有关系显示为不可用，不级联删除或强制启用。

## 9. 迁移、兼容、备份与回滚

quant升级名单与language 2→3名单分离：schemaUpgradeIds可含quant，languageUpgradeIds仅learning/languages，阅读升级提示只请求该两模块；quant升级复用builtin-upgrades API/CLI但入口放quant专区。quant变更必须在legacyBuiltins快照之后且只作用quant克隆；不调整learning/languages定义或顺手清理无关导出。

新建空工作区使用 quant schema2；已有工作区不会因启动/浏览页面自动升级。显式预览升级目标、备份位置与变更，复用 builtin-upgrades/migrateModule；严格识别冻结的quant schema1 manifest；新封装导入也比较完整已知quant v2结构而非只看schemaVersion，允许 enabled/codeVisibility 等现有可变属性，未知自定义结构拒绝。保留原 name/导航 label 的个人覆盖，不把 UI 标题改名等同于实体 ID 迁移。

升级只新增可选字段与 journal 类型；既有 records、ID/kind/type、正文、未知 frontmatter、关系、历史、conflicts、收据、删除标记、enabled/private 状态均保留，不能用“重导入”迁移。显式 schema +1；旧数据不强行填 researchMeta，不把 legacy result 推断成历史真实市场数据。

SQLite模块迁移和操作日志按既有机制事务化；新增备份回读/hash与临时隔离试恢复验证。备份所对应数据库head/模块状态/笔记摘要在迁移事务取得写锁后再次比对，间隙发生写入即中止且重新备份，不迁移未被备份的状态；不是宣称现有migrateModule已提供此保护。文件恢复失败可观察。旧备份恢复仍能加载 schema1，用户显式升级；新备份恢复必须保留链和收据，重放零写入。schema不匹配的同步走既有显式迁移/bootstrap，不能自动接受新 manifest 或丢弃新字段。

回滚分层：代码撤回在独立候选/云端分支进行，保留证据；数据不能直接降 schema。需要回滚时停写并保全整个工作区文件，以迁移前备份恢复到新目录，验证后再由用户决定切换；原目录和新增记录保留，不覆盖现有 `.local`/Application Support。文档评审阶段没有数据变更，无数据回滚动作。

## 10. 云端实施拆分、依赖与写入归属

父协调确认前置云候选dcaa及原范围双审后的串行修复已整合、没有竞争writer，并提供最终commit及本文最终hash后才启动实施。每一步一个代码写入者；共享 Store/server/modules/web 变更由主实施者串行整合。只读审查可并行，不能再起另一个量化 writer。P0–P6期间唯一正式PROGRESS写入者仍为父协调；云端实施者以阶段结果回报，不直接编辑该文件。父协调先保存本地未提交进度，按最终云基线逐段整合后再更新；不拿旧云副本覆盖本地。只有父协调明确转移写入归属后云端才能维护同一文件，转移期间旧writer停止；不另建工具专用进度。

| 步骤 | 范围与依赖 | 可交付完成条件 |
|---|---|---|
| P0 基线交接 | 以dcaa738444579b7cc45c730b001cdf82ddcb19b6为至少需覆盖的候选，等原范围双审修复串行整合并确认最终HEAD；核对ancestry/差异、dirty、AGENTS、PROGRESS及本文hash；重读语言/Obsidian、导航/schema/Store/API接口 | 明确新 baseline、差异和允许文件；没有覆盖或回退他人工作；冲突先记录与父协调处理 |
| P1 契约/合成夹具 | 新 `src/research-contract.ts`（或同等纯模块）、schema、合成 examples/tests；不导入 Trader 私有文件 | 先交付4.5完整Schema与合成成功/失败/缺证文件组及独立golden，再实现规则；strategy映射与重复事实一致性冻结，旧v1回归不变 |
| P2 quant 显式升级 | `modules.ts`、`builtin-upgrades.ts`、API/CLI升级入口；依赖P1 | 已知v1保留身份、停用/private、正文与所有历史；自定义拒绝；隔离备份恢复测试 |
| P3 导入事务及同步 | `research.ts`、Store有界扩展、共用验证器、sync/restore；依赖P1/P2 | 原子前驱/重放/人工改动/删除/失败恢复/跨入口/并发验收；无新独立状态库 |
| P4 离线适配器 | 固定CPython 3.12标准库原生核验＋TS封装，在LifeOS仓库维护；依赖P1 | 仅合成文件完成身份链、成本、脱敏和路径/变更拒绝；Python检查纳入npm check与CI，缺运行时直接失败，禁止跳过；不执行/修改Trader，无网络 |
| P5 真实入口与产品体验 | 扩展API/CLI、ResearchWorkspace、ResearchPanel保留projects路径、少量styles及既有文档；依赖P2/P3 | 预览确认/错误/重试/比较/日志/复盘/数据源/可选学习关联完整；同步更新README、architecture（新namespace有序链例外）、sync、acceptance D06、CLI帮助及合成样例；桌面/手机可用 |
| P6 验收与独立复核 | 下表全部场景、check/e2e、release scan；依赖P4/P5 | 完整证据、已修发现、最终代码版本和剩余外部边界；不得将合成通过说成真实Trader已接入 |
| P7 本地真实验收（后续授权） | 用户明确允许的运行与文件白名单、目标数据目录、最终适配器版本 | 本地先预览，仅允许数据写入授权目标；不上传；源码/云测试通过不自动启动这一步 |

允许文件以P0实际复核为准，默认范围是研究契约/服务、Store与同步的必要边界、quant manifest/显式升级、现有HTTP/CLI、研究UI、合成夹具、关联测试和既有说明，另含适配器测试的package.json及CI配置。不要借机重写全应用导航/权限/同步。若原机制无法安全表达修订链，应报告具体契约冲突及可逆方案，不能用新产品确认流程掩盖。

## 11. 测试与正式实施验收矩阵

P0确认CPython 3.12；后续实施添加 `npm run test:research-adapter`，命令等价 `python3.12 -m unittest discover -s tests/research_adapter -p "test_*.py"`，接入npm run check，CI显式setup-python 3.12；缺失解释器/测试发现为0均失败。规划阶段不安装/执行。

所有样本合成，固定时钟/时区；测试名称可调整，行为不可减。单元测试不是常量互相比对；旧机制反例限定为：R06的同前驱跨进程竞争、R07/R11的远端修订与本地手改、R10的新pending被旧清理删除、R11的bootstrap缺链和分叉、R12的来源抢注、R13的原始字节/重复key与新路由错误映射。在P0最终基线若问题仍在，用等价旧路径记录预期失败与commit；前云已修者保留其回归证据，不人为重新造红。新能力测试正常按契约验证，不机械要求旧代码实现新协议。耗时数字和历史通过数量不是判据。

| 编号 | 场景 | 必须观察到的结果 |
|---|---|---|
| R01 | 成功正/负收益、失败、未终态、取消/中断、缺证、仅定义 | 成功/失败事实真实；单total_return+完整证据允许、只有数字无证据拒绝；不支持/缺证不写；不把负收益当失败，不把仅定义当未运行 |
| R02 | 合成/历史/unknown、approximate、源声称/摘要核验 | 四层语义持续保存并在列表/详情/比较可见；不出现“实盘/已复现”伪证 |
| R03 | identity/summary/hash/时间/代码/数据/定义链错配 | 拒绝；历史代码hash不同于当前时保留历史，不补当前hash；原生算法与外层独立golden；同一源时点不同offset/宿主时区导出同一UTC payload |
| R04 | 0.001→10bps、正回撤、金额/比例/计数、最低费/税、缺成本 | 单位正确；未知非0；成本缺口显式，超额参数不可比；失败不带成功指标 |
| R05 | 首次、同包重放、同修订异内容、新job同artifact、合法+1 | 单实体零重复、冲突拒绝、新job独立、历史完整；同版适配器重放不变、升级/补证+1、前驱包/alias配置错配拒绝；旧v1行为保留 |
| R06 | 未见旧修订、跳修订、错前驱digest、并发相同/分叉 | 不倒退；以worker/子进程独立DB连接和屏障，在读校验后/写前注入竞争；不能用同事件循环Promise.all假冒交错；仅一个接受分叉，不靠按钮禁用 |
| R07 | UI人工改受管字段、外部Markdown编辑、关联review | 新修订不覆盖改动；reset预览取消无写入、确认保留人工历史；远端合法N+1的local-edit冲突经显式重试转resolved后可继续，fork重试仍拒绝；独立review/journal不受影响；迁移系统元数据不引假冲突 |
| R08 | 删除后旧包/新包、目标关联删除/越权/停用、schema过期 | 不复活、提交重新核查、无静默目标替换；权限/历史语义保持 |
| R09 | 预览后换文本/目标/重启/过期、提交成功响应丢失 | 过期/变化重预览；已提交同包重试能确认同一实体、零新版本；CLI适配/preview/status不建目标目录、不改DB/Vault/pending/operations/audit |
| R10 | DB commit前故障、commit后/Vault失败、恢复重启 | 前者零业务写；后者明确已提交待恢复，response丢失+外部修改+重启组合可用只读status确认；两进程屏障证明新pending不被旧清理删；恢复不覆盖外部文件 |
| R11 | 同链跨端重放/分叉、A→B→C bootstrap/backup/restore、旧schema | 旧包确认/下一修订/手改冲突均可复验；人工/迁移/baseline操作使用整操作摘要，不错认来源证明；未处置分叉使bootstrap拒绝，处置后可传accepted链；缺失/篡改历史拒绝；分叉重复零新增，处置不污染accepted链；protocol3旧端拒绝，超限不截断；删除不复活 |
| R12 | 通用save/import/source伪造保留namespace/metadata、agent令牌 | 不能通过新建、移除、更换保留namespace或旧schema历史绕过链；agent不可写/迁移，CSRF/Host/Origin原测试保持 |
| R13 | 重复JSON键、深度/大小/数字边界、危险键、未知版本/字段 | UI/CLI/HTTP使用原始字面字节输入、fatal解码，同码拒绝且无写入；无关外部修改也不触发capture；错误不含输入原文 |
| R14 | 越界/父目录替换/符号链接/硬链接/读中替换/非法UTF8/FIFO/ZIP/表格/未知产物 | 只读允许普通文件，不读账户表/网络、不import Trader；源文件字节前后一致 |
| R15 | 不同窗口/成本/口径/数据性质；projects比较 | 可比性原因正确，无排名；projects函数/HTTP/UI原比较不退化，通用Comparison也使用同一口径组件，失败/缺值不计作0 |
| R16 | schema1完整旧库、自定义schema、停用/private、迁移故障 | 无自动迁移，自定义拒绝，所有原ID/正文/未知frontmatter/历史/收据/冲突保留；quant不进入语言pending、非quant manifest不变、备份窗口变化拒绝迁移 |
| R17 | 桌面及手机完整入口：文件→预览→确认→详情→比较→日志/复盘→重启 | 独立种子工作区、可注入now/preview secret与commit前故障点；真实Tab/Enter/焦点断言，重启沿用现有lifecycle进程模式，表格窄屏可读，所有状态可见；跨域关联不复制实验/学习分钟 |
| R18 | 八领域导航/自定义分类标签/启停/财务金额/语言阅读Obsidian回归 | 不新增冲突领域、不改自定义标签、不把回测收益写finance、不覆盖前云任务成果 |
| R19 | 非敏感发布扫描、样例内容检查 | 公开仓库只有合成fixture及通用实现，无私有路径/真实Trader指纹/账户/交易/策略或原始报告正文；LifeOS公开代码基线hash与本计划/审查文件hash属于交付证据，不属于禁用私有指纹。额外本机扫描使用仓外private-pattern配置，不把真实黑名单写进源码 |

收口必须在最终候选实际运行 `npm run check`、`npm run test:e2e`，再按项目现有发布扫描流程执行 `npm run release:scan`（不因此获准发布）。保留失败日志、版本和必要截图；适配器另有离线合成文件测试。测试服务/临时目录由唯一实施者清理，不能停止用户旧服务。P7未做则明确“真实Trader接入未验收”。

## 12. 停止条件、待决事项与交接

以下才需要停止依赖步骤：前置云 writer 未停止或文件归属不清；指定基线/正式验收需改变；旧/自定义数据迁移无法保全；隐私白名单无法确定；插件 OS 保护未生效；必须读取真实敏感数据/新凭据/联网付费资源；同步分叉机制无法满足链约束且要改变正式契约。其余可逆实现细节由实施者有据决定，不为普通拆文件/增加验证反复征求许可。

当前不存在阻挡合成开发的必要用户产品决定。真实本地阶段尚需用户选择允许的运行文件、脱敏人工文字与目标数据目录；这是P7的前提，不是云端P1–P6的阻塞。unknown成本/代码/时间应如实待补证，而非把补资料当成允许伪造默认值。

交接给云端时必须一起提供：本文完整文本及SHA256、独立审查与逐项裁决、前云任务最终HEAD及范围、P0复核要求、原规则与唯一进度入口。只传摘要不够。云端确认 hash 后执行P0–P6；不启动P7、不推送或发布，远程写入身份/noreply/受限历史条件仍按项目规则由父协调核实。

本计划可随独立审查修订，但不因审查建议扩大真实数据/交易授权，也不把“审查完成”当作实现完成。最终交接由父协调逐字核验文档与哈希后串行安排，当前规划任务不主动向其他线程发消息。
