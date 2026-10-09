# 本地版本验证结果与未完成项

**当前状态入口（2026-10-04）：** 后续 Mac 迁移、日期修复及分类/配置验收已完成，见本文件后续日期章节；下列 2026-10-02 的“Mac 未实测/远程暂停”仅为当时历史。远端业务 `feat/local-life-os` 已只读核验为 `e6056782`，main 仍初始 README。旧 CI [37170415014](https://github.com/BryanYue/life-os/actions/runs/37170415014) 的 job/安装/check/E2E 经个人 GitHub 连接只读核验均 success；它没有发布扫描步骤，也不证明本轮候选通过。

日期：2026-10-02。指定 Linux 工作区，Node 24.19.0、npm 11.9.0、系统 Chromium。当前轮次基于 `c514925` 增加综合阅读、清单提醒、有依据建议、思考表达及旧数据升级；当前实现提交 `74d50358a97f40d7f45fa4a9b5f4d1b1d4eb1cfa`；此前八领域、同步权限与插件生命周期实现在 `63fa8dd7fa0f426fc41fc1f3530317c557bbc535`，原有验收继续保留。所有数据均合成，没有真实 Vault、账户、设备、策略或云同步连接。旧交付 bundle 固定 `c513c613`，没有重新打包。

## 本轮学习产品的实际执行

- `npm run check` 全量通过：ESLint、TypeScript、**174/174 单元/集成/CLI，0 跳过**，生产构建通过。日志位于执行器临时目录 `/tmp/life-learning-check.log`。
- `npm run test:e2e` 全量 **27/27 Chromium 通过，0 跳过，1.5 分钟**。原有 21 条保留；新增 6 条走真实 API 和生产界面。日志 `/tmp/life-learning-e2e.log`。
- `npm audit --json` 全依赖 **0**（当次查询）。锁文件与前阶段兼容版本保持一致。
- `release:scan` 检查 **91 个源码文件**、暂存内容、当前分支可达历史/作者和 web-dist，无配置模式命中；同时人工核对只有通用代码、说明和虚构测试数据。模式扫描不保证绝无私人内容。
- 提交 `74d5035` 的干净本地 clone 实际通过 `npm ci`、生产构建/回环启动，八领域/16条虚构演示、研究/XML导入、新阅读/打卡/提醒/表达流程、重复阅读操作仅一条事实，25条记录重启与加密CLI备份/隔离恢复后完整保留；植物注册仍不改核心。编译后内置升级CLI确认已是当前版本。临时进程/目录已清理，日志 `/tmp/life-learning-clean.log`；这是Linux证据，Mac原生仍未实测。
- 综合阅读验证合法来源声明、原文/未知 frontmatter 保护、响应丢失后原操作重试、多目标唯一分钟、解释推断、词汇零重复计时、来源编辑和重启。来源声明不是自动版权核实，也没有抓取第三方全文。
- 清单/提醒验证创建、原子完成/撤销、稳定幂等、权限变化、延后/确认、关联目标回顾。手机 390px、Asia/Shanghai 实际落库 `+08:00`；提醒只在页面内生效。
- 建议验证规则证据、多目标、读取零写入、明确人工采纳为计划、重复/过期拒绝；可选到期时间的纽约 DST 缺失/重复钟点必须修正，不能被静默忽略。无付费 API、通知授权或外部执行。
- 表达验证自由原稿、可变数量理由与证据、原稿/整理稿对照、推断来源提示、关联证据权限与同步范围、口头文字记录、不复制时长；桌面与手机均实际操作。结构完整不表示事实正确或能力已提升。
- 兼容升级验证原版 v1 两模块分别迁移并备份、原文/未知 frontmatter/停用/私有标记保留、自定义清单拒绝覆盖，浏览器明确确认后升级及重试。共享时间解析覆盖上海、东京、纽约、Lord Howe 半小时切换和非法日期。
- 表达重试的两个真实缺陷在旧实现 **2/2 回归失败**：目标完成后创建重试被拒绝，证据删除后修订重试摘要变化。修复后表达专项 **8/8** 及独立内存原路径复验通过；重试核历史请求与当前权限，保留后来稿件、不给删除证据复活，数据库与虚构 Vault 无额外写入。
- 手机检查发现受控打卡勾选会在 API 返回前回弹，修复为请求期间状态提示与禁用、失败恢复。日期控件改用原生表单校验，保留用户输入，最终完整浏览器回归通过。未修改既有验收阈值或降低断言。
- 桌面与手机长页截图均已目视检查，无横向溢出；截图只存执行器临时目录，不生成新的交付包。Mac 原生/Safari/实际手机硬件未运行，手机结果是 Chromium 设备尺寸及时区模拟。

## 前一阶段已提交证据（63fa8dd）

| 检查                 | 结果                                                 | 入口                                        |
| -------------------- | ---------------------------------------------------- | ------------------------------------------- |
| 固定依赖             | 安装 saxes 6.0.0 与 lock；Node 24 原生 SQLite        | package.json / package-lock.json            |
| ESLint / TypeScript  | 全量通过                                             | `npm run check`                             |
| 单元/集成/CLI        | **121/121 通过，0 跳过**                             | `npm test`（check 内）                      |
| 生产构建             | 通过，Vite + TypeScript                              | `npm run build`（check 内）                 |
| Chromium             | **21/21 通过，0 跳过，50.2 秒**                      | `npm run test:e2e`                          |
| 当前依赖漏洞查询     | 全依赖 0（当次结果，不保证未来）                     | `npm audit --json`                          |
| 干净本地 clone       | 当前实现 63fa8dd 干净 clone 全部通过                 | npm ci/构建/生产启动/写入/重启              |
| 发布内容扫描         | 71 文件及暂存区、当前分支可达历史/作者、构建检查通过 | release:scan，范围含源码/暂存/可达历史/构建 |
| Mac 原生 / GitHub CI | 未运行                                               | 缺 Mac 执行证据，远程写入暂停               |
| PR / 合并 / 部署     | 未创建 / 未执行 / 未执行                             | 不改认证、不重试远程写入                    |

完整 check 首次因新文件中未使用 import 被 lint 拒绝，删除该无用 import 后重跑整个 check 得到以上 121/121。新增 review HTTP 测试编写时误用了不存在的情境值/学习类型；按原有 Schema 改为“普通”及 `learning/session` 后通过，没有改 Schema 或放宽业务断言。

干净 clone 使用当前功能分支，执行 `npm ci` 与生产构建后，以编译后的 Node 服务实际验证：8 模块初始空库、16 条虚构演示记录、研究和 XML 导入后 19 条记录、停服重启保留、无需改核心注册植物后 9 模块、静态资源及财务/健康报告、编译后 CLI 加密备份/恢复和隔离状态。测试进程与临时目录已清理；这是 Linux 执行证据，不冒充 Mac 原生验证。

## 业务流程证据

- D01：原三情境与采纳幂等；新增连续跨周轮换、显式容量系数、固定块/五类预留、地点交通、DST 缺失/重复/跨切换窗口拒绝或偏移选择、零容量缺口、366 天容量案例。已有八领域活动目标、长期方向与语言目标可选择并真实 `supports` 关联；临时文本目标明确不关联。复盘只按唯一 `actual-of` 事实生成建议，跨领域/缺失第二目标的歧义不重复计数。`planning-advanced.test.ts` 14 项，另有 core 和 period-goals/specialist E2E。
- D02/D07：`analytics.test.ts` 18 项，健康状态/单位/主观设备区分、计划实际统计、歧义事实保留趋势但不重复计入；精确变精度十进制、币种分类、手录直接汇率及来源日期、缺汇率、账户快照/净资产 UTC 历史、导入修订/重启/备份。specialist 浏览器走真实报告和底层来源入口。
- D03：core 学习目标→材料→学习→笔记→项目输出→周复盘，移动 Markdown 后稳定 ID 关联。
- D04/D05/D06：`domain-workflows.test.ts` 专门验证问题→学习→里程碑→任务→两版实验→评价/输出/复盘和重启；英语日语材料/四项技能/复习/项目/旅行准备、目标独立性；研究未运行/失败/成功、版本/数据/代码/参数/成本差异、HTTP 导入比较。specialist 浏览器执行文件/文本导入和比较。
- D08：core 虚构未成年人、重要日期改期、约定/共同事项/互动、复盘与备份恢复；全部家庭数据拒绝同步，无自动联系。
- 八领域基础 Store/浏览器循环继续验证编辑、查询、关系、复盘、回收站和持久化。该循环只验证基础流程，领域完成判断使用上述专项证据。
- A01：`apple-health.test.ts` 验证合成 Apple XML 的步数/心率/Workout、单位/时区/DST、同步身份修订、未知类型跳过、解析及语义错误整批不写、外部实体/恶意 DTD 拒绝。允许惰性 ELEMENT/ATTLIST 格式声明，不应用默认值或实体定义；真实 Apple 导出文件与 A02 自动联动未验证。

## 协议、权限和插件证据

- `sync-bootstrap.test.ts` 10 项：schema 1→2 后初始化空副本、明确清单接受、继续离线合并、来源修订同 ID；记录/关系次序、无效包事务回滚；实体/字段/正文/来源/hash 隐藏及保留私有数据的字段补丁；只读投影隔离/删除/旧包/篡改；孤立笔记预检；A→B→C 继承历史收据；受限创建重试；完整同步不能绕过投影元数据授权；损坏协议状态恢复不发布目录。
- 独立只读审查用内存 SQLite 实际复现后确认四项修复：孤立笔记此前导致先提交后失败；第二次 bootstrap 曾丢继承收据；受限创建重试曾误判自动来源；字段 scope 曾从完整同步泄露标题/来源。修复后的原场景均复核通过，没有仅凭测试文件存在宣称通过。主线程随后又复现字段写授权可改变状态/删除的缺陷，新回归先失败，修复后完整 check 121/121 和最终权限专项 10/10 通过；完整权限仍可正常删除。
- `plugins.test.ts` 9 项：完整契约校验、默认读/建议与显式写、外部执行拒绝、字段读取/补丁、声明式导入器、跨模块依赖、升级迁移回滚、停用/卸载保留数据、恢复重新授权、可信 stdio 超时/输出/环境/文件/子进程权限、代码变化和运行中撤权拒绝、失败不提交暂存写入。真实本机回环探针证明 Node permission **不隔离网络**，不是恶意代码 sandbox。
- `lifecycle-api.test.ts` 2 项：HTTP bootstrap/projection（含命名空间模块）、Agent 实体/字段范围；未登录、CSRF 和 Agent 凭据拒绝新管理入口；插件安装授权启用、真实 stdio summarize、导入、停用。
- `lifecycle-cli.test.ts` 3 项：真实子进程加密 bootstrap/迁移/历史重放/来源 r2 增量、明文 projection；跨进程插件生命周期和仓库路径拒绝；两个新增虚构研究/XML 样例实际 CLI 导入与重复去重。研究样例保持 plan/draft/result 空，健康重复后仍两条，不伪称已执行回测或连接设备。
- 新设置页浏览器验证只读投影隐藏内容且不生成主记录、清单接受前拒绝/接受后初始化/重复 0；插件信任双选择、声明式创建/导入、升级重授权、停用/卸载数据保留。未发送真实外部请求。浏览器新增插件/目标选择器曾因嵌套标签匹配超时，补明确 aria-label；同步范围展示改为复用核心投影判据，增加实体选择/缺键/family/空范围实际 config 重启回归。完整最后运行 21/21 通过，未放宽原业务断言。

## 保留的高风险安全回归

上一轮最初五个安全场景在原 `c513c613` 基线 **5/5 失败**，修复后 `tests/safety-regression.test.ts` 扩为 10 项，本轮原断言全部保留并通过：

1. **新实体不能覆盖未托管同名 Markdown。** 新文件排他创建/选非冲突名字，既有笔记替换前再次校验 hash；用户原文保留。
2. **缺表或无效恢复不能发布部分数据库。** 完整逻辑表、当前 Schema、笔记/索引/路径、关联、历史/冲突/游标等在隔离临时目录验证后才发布；失败无目标目录、可修正后重试。
3. 来源身份与修订收据跨副本重建，防止重导产生新实体；双端首导同一来源也去重，人工编辑不污染原收据。
4. 跨范围关系当前/历史快照拒绝、Agent 凭据不能获取人工会话；坏凭据不能靠 cookie 回退。
5. 原有崩溃恢复、外部正文保护、未知 frontmatter、移动路径、停用模块恢复、Schema 迁移回滚、冲突解决传播继续通过。

`sealed.test.ts` 仍验证 AES-GCM 错钥/篡改/用途/版本、真实 CLI 往返、私有密钥权限、路径/符号链接及不同 cwd；密钥只在临时目录创建清理。

## 精确边界与外部阻塞

- **本地已可用：** 八领域流程、模块/插件生命周期、实体权限、只读字段分享、跨 Schema 当前基线、离线模拟/冲突/备份。这里不把真实设备/云阻塞拿来替代可本地完成的业务。
- **外部条件：** 已通过现有个人 GitHub 连接核实仓库写权限，但当前云终端的注入凭据仍未切换，身份查询返回 Forbidden；没有改变全局/公司凭据，也未生成持久凭据。Mac 原生未实测；真实云连接器未实现，本轮仅验证通用本地协议。Watch/Health 自动连接按用户要求延期，不列为本轮阻塞；真实外部研究仓库未接入。没有 PR、远程 CI、云自动同步或真机联动证据。
- **明确实现边界：** 字段投影只读，完整记录才能双向同步；已含数据的副本需各自显式迁移，不自动猜转换；可信 stdio 不提供不可信代码 OS 网络沙箱。XML 只支持所列数据类型，不是全 Apple 数据导入器。
- **数据保管：** 浏览器/普通导出、SQLite/Vault/迁移备份仍明文。可选密钥文件不是设备身份/撤销/Keychain。备份不包含未知附件/笔记、插件代码和信任授权；无自动备份保留或永久历史清理。
- 本地根提交 `110ca3fe96c3b98861c0141f4ce5cf4ba1b85603` 保持原 README tree、使用指定 noreply。最新只读核查远程 main 仍为原 SHA `7ebb56b933b9faceb9c1f4db2aff19f38d220458`。现有 API 缺指定作者元数据与 expected-old-SHA 参数，未用不等价的 API 强制更新替代安全推送；旧 hash/cache 不保证消失。
- 不创建新 bundle；旧包 `c513c613` 不含当前功能。开源许可证仍未决定，公开可见不等于许可证授权。

未修改正式需求/验收语义。当前规则只在项目落实，没有更改账户全局设置或宣称文档会切换实际模型。

## 2026-10-03 Mac 原生迁移验收（最新本机结果）

本节为本次 Mac 实测，前文 Linux 结果及“Mac 未实测”记录保留作历史。迁移负责人为本机任务主代理；未接手云端功能开发，未修改产品源码或测试判据。

### 来源与本机安装

- 目标：`$WORKSPACE/life-os`。恢复前目标不存在；没有覆盖既有项目或私人数据。
- 来源：个人 Library 的最新安全迁移包，version 0，406531 bytes；准确文件身份保留在仓库外本机迁移证据中。
- 迁移 ZIP SHA256：`db299da32b2efc458bc8e4f30cc10914e16240fcdafc069bf49e7eb6494bac17`。本机下载文件已核对大小、SHA256、Library ID/version 扩展属性；解包前检查相对路径与符号链接。
- 包内校验全部通过；从 bundle 恢复分支 `feat/local-life-os`。HEAD `5f1ff295801dc5e3eb3e6422a6b90cdcff931230`，实现提交 `74d50358a97f40d7f45fa4a9b5f4d1b1d4eb1cfa`，8 个提交、91 个文件逐一核对大小/SHA256，Git tree `9396baa68aaec94d21d90ba72571c519a100a187`，`git fsck --full` 通过，恢复后初始工作树干净。
- macOS 26.6.2 / arm64；专用 Node 24.19.0 / npm 11.17.0。Node 来自官方发行归档，ARM64 tar.gz SHA256 `8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d` 与官方清单一致。
- 专用运行时及日志：`$WORKSPACE/life-os-local-ops`。未替换全局 Node 26，未修改账号、token、SSH、全局设置或 GitHub 远程。
- `npm ci`：199 packages，审计 0 vulnerabilities，锁文件未修改。安装脚本提示按原样保留在日志，未执行全局 approve-scripts。

### 实际结果

| 检查                              | 本次结果                                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 默认 Mac 临时目录下 check         | lint/typecheck 通过；168/174 测试通过，6 项 stdio 插件失败；因串行 check 终止，此轮未构建                                                    |
| 指定专用真实路径 TMPDIR 后 check  | lint/typecheck、174/174 单元/集成/CLI、生产构建全部通过，0 skipped                                                                           |
| Mac Chrome 154.0.8037.93 全量 E2E | **26/27 通过，1 项失败**；未改断言、未跳过场景、未将旧云端 27/27 当作本机结果                                                                |
| 生产 HTTP 服务                    | 编译产物启动，127.0.0.1:4310，静态页面与 8 模块可用                                                                                          |
| 综合阅读                          | 两目标共用一次 30 分钟；重试返回同一记录；解释/词汇不增加时长，原文不变                                                                      |
| 清单与提醒                        | 完成/重复操作/撤销、到期提醒/延后/确认通过；应用内提醒，不是系统推送                                                                         |
| 建议与表达                        | 建议读取零写入，明确采纳及重试仅生成同一计划；表达原稿保留、整理稿和依据回链可读，反馈仍为推断；全部动作后总阅读仍为 30 分钟                 |
| 真实生产进程重启                  | SIGTERM 完整退出后同数据根重新启动；28 条虚构记录全部 ID/version/body/relations 及阅读、提醒、表达报告深度相等                               |
| 编译 CLI 加密备份与隔离恢复       | 生成仅用于虚构数据的独立本机测试密钥，错误密钥拒绝且不发布恢复目录；正确恢复保留同一 28 条记录和全部快照，status.restoredIsolated=true       |
| 启停入口                          | 停止本任务拥有进程、再次启动、重复启动复用同一 PID 通过；没有开机启动项                                                                      |
| UI 目视                           | Codex 本机内置浏览器实际打开“本地服务已连接”、28 条记录、8 模块；阅读页显示一次总计30分钟、两个目标各覆盖30分钟；正式E2E桌面/390px截图已查看 |

生产验收数据均明确为虚构。原演示目录 `$WORKSPACE/life-os-demo-20261003`；隔离恢复目录 `$WORKSPACE/life-os-restored-20261003`。没有读取默认私人 `~/.life-os` 或接真实健康、金融账户。

### 两项本机发现与边界

1. **Mac 临时路径兼容限制，已用运行配置解决本次启动。** 原源码 plugins.ts:815 使用 tmpdir()，随后仅允许读取复制的入口文件。Mac 默认 `/var/...` 经过 `/var -> /private/var` 别名，Node 24 权限加载入口时报 ERR_ACCESS_DENIED，resource=/var。相同文件改用真实 `/private/var/...` 路径的最小复现通过。专用启动器及全部复验设置 `TMPDIR=$WORKSPACE/life-os-local-ops/tmp`（0700、无符号链接）；保留 --permission 和精确入口文件白名单，未放宽任何插件权限。默认 Mac 临时路径仍是原源码兼容边界，不能直接用全局 Node 26 的普通 npm start 代替专用入口。

2. **建议默认日期的时区问题仍未修复。** 失败位置 tests/e2e/reading.spec.ts:409，尚未进入其 DST 输入断言。2026-10-03T01:01Z 时纽约本地为 Oct2；web/AdvicePanel.tsx:132 用浏览器本地日期初始化“UTC 日末”参考日期，src/advice.ts:88/150 则按 Oct2 23:59:59.999Z 过滤，新建 Oct3 UTC 目标被排除，卡片为0。独立调用原编译 generateAdvice 复现：参考Oct2无该目标，Oct3有该目标。属于跨平台日期不一致，测试依赖实时钟而显现，不是已证实的 DST 校验逻辑错误。临时方法：展开“建议范围与参考日期”，选当前 UTC 日期，再点“按参考日期查看建议”。本次保持云端源码基线，交回唯一功能开发者修复；未缩小测试范围冒充全绿。

Safari、真实 iPhone/Watch 硬件未测试；390px 是本机 Chrome 视口模拟。真实云连接器未实现，Watch 自动连接仍延期；GitHub 推送身份阻塞保持独立处理。数据库/Vault 明文、可选导出加密和无系统通知等已有边界不变。

### 可打开入口与证据

- 页面：http://127.0.0.1:4310 。本轮结束时保留本任务启动的回环服务；当前 PID 以 `life-os-local-ops/server.pid` 为准。
- 双击 `$WORKSPACE/life-os-local-ops/Start Life OS.command` 启动/打开；双击同目录 `Stop Life OS.command` 只停止命令行匹配的本任务进程，数据保留。
- 日志：`life-os-local-ops/npm-ci.log`、`check.log`（首轮失败）、`check-mac.log`、`e2e-mac.log`、`production-smoke.log`、`server.log`。
- 结构化结果与前后快照：`life-os-local-ops/acceptance/result.json`、`before-restart.json`、`after-restart.json`、`after-restore.json`、`cli-results.json`。
- 截图/失败上下文：`acceptance/life-reading-desktop.png`、`life-reading-mobile-shanghai.png`、`e2e-failed-ny-advice.png`、`e2e-failed-ny-advice-context.md`。
- 本次只追加本地验收文档和项目进度；产品源码/测试/锁文件与导入基线一致，未提交、推送、合并或公开部署。原云任务保留。

## 2026-10-03 建议 UTC 默认日期修复与最终 Mac 验收

本节为最新结果，取代前一轮“26/27、建议默认日期待修复”的当前状态；保留该轮失败记录作对照。

- 授权与基线：用户继续授权本机最小修复、回归与本地提交。恢复前核对 HEAD 5f1ff29；仅两份上轮任务自有文档改动，逐字比对确认没有覆盖后续用户改动。唯一代码写入者为本机主代理，云端未启动并发 writer。
- 变更：AdvicePanel 的默认参考日期使用 `new Date().toISOString().slice(0, 10)`，与现有“UTC 日末”标签和服务端契约一致；不改变手动参考日期、建议规则、后端筛选或 DST 时间转换。
- 新增两项真实浏览器回归：纽约当地前一日、上海当地次日。固定浏览器时钟并显式设置虚构目标时间，验证默认 UTC 日期、当日当前目标和 23:59:59.999Z 目标可见、下一日 00:00:00Z 目标排除。
- 原纽约 DST 场景保留 gap/fold 提示、原输入保留、未选偏移零写入、选择 -05:00 后保存及 America/New_York 的全部断言，只固定时钟和种子时间消除实时日期漂移。
- 修复前对照：上述两个新场景及原 DST 场景 **3/3 失败**。纽约实际日期错误为 Oct2，上海为 Oct4；原 DST 卡片为0。没有改变判据来迁就实现。
- 修复后完整 `npm run check`：lint、typecheck、**174/174** 单元/集成/CLI、生产构建全部通过，0 skipped。
- 修复后完整 `npm run test:e2e`：Mac Chrome **29/29 通过**，包含原27项、新2项UTC边界及原失败纽约DST场景；不是仅跑定向场景。独立只读审查无阻断发现。
- 数据保护：测试前停止本任务拥有的演示服务；所有测试使用独立临时虚构数据库。原数据目录29个文件在测试前后SHA256完全一致；随后恢复同一目录，生产入口 HTTP200。没有用原数据执行测试写入。
- 证据目录：`$WORKSPACE/life-os-local-ops/advice-date-fix-20261003/` 中的 `baseline-regression.log`、`check.log`、`e2e.log`、`data-unchanged.json`、原始失败截图。提交SHA由同目录 `result.json` 和 Git 历史记录。
- 本机入口仍为 http://127.0.0.1:4310 ，启停脚本和专用 Node24/TMPDIR 配置沿用前节。原源码的Mac默认符号链接临时目录限制未扩展修复，必须继续使用本机专用入口。
- 本次范围无已知未修验收阻断。Safari/真实手机未验收；真实云连接器未实现，Watch自动连接延期；无远程写入、凭据/全局设置变更或公网部署。

为便于后续通用源码流转，仓库内文档的机器路径使用 `$WORKSPACE` 占位，个人 Library 标识保留在仓库外迁移证据，完整本机原始记录亦保留在本次证据目录；未删除实际迁移输入或数据。

## 2026-10-03 分类、个人配置、语言与模板验收

本轮从 `25a566f`、`feat/local-life-os` 的干净工作树开始。用户明确批准本地实施，并在执行线程确认隔离验证与通过后本地提交。原服务使用源码目录的旧编译资源，因此全部构建与浏览器测试在 `$WORKSPACE/life-os-local-ops/personalization-20261003/verification` 副本中进行；复用已安装依赖，不宣称重新执行了 npm ci。继续使用 Node24.19.0、真实路径 TMPDIR 与本机 Chrome，测试监听独立回环端口。

| 检查                    | 实际结果                                                                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 最终 `npm run check`    | lint、typecheck、**228/228** 单元/集成/CLI、生产构建全部通过；0 fail、0 skipped                                                                                                                          |
| 最终 `npm run test:e2e` | **35/35** 通过（1.3分钟）；原29个测试文件/业务断言未修改，新增6场景                                                                                                                                      |
| 新场景                  | 八分类、停用项目/量化与只读历史再启用；仅learning阅读/解释及语言依赖；个人韩语配置和显式升级、旧值保留及唯一计时；模板预览零写入、采用丢失响应幂等；模板v1/v2精确选择与非法JSON拒绝；390px个人配置持久化 |
| 失败与保全              | 配置冲突/坏文件/路径边界；迁移保持启停；插件升级配置写失败、rename不确定、COMMIT失败、提交后笔记恢复失败；未知文件完整保全、非空WAL/符号链接拒绝、取消与目标竞争、旧逻辑备份恢复；均用隔离虚构数据       |
| 独立定向复核            | 已闭合迁移启停绕过、升级依赖失败时序、保全仓库路径、模板版本、非法分类值、同名语言统计及升级持久化风险；最后复核未发现剩余可复现阻断                                                                     |
| 桌面/手机显示           | 独立生产预览1440×1000与390×844实际Chrome截图检查，16条虚构样例、无页面脚本错误、无横向溢出；不是Safari或手机硬件验证                                                                                     |
| 既有数据与进程          | 原演示31文件（含WAL/SHM）及恢复副本29文件，逐文件大小/SHA256全部未变；原服务PID46882和启动时间未变，没有重启、迁移或切换原数据                                                                           |

保留了失败证据：首轮因本次fieldset滚动布局遮挡保存/取消按钮，两个旧场景失败后停止同因运行；恢复独立滚动div后原29项全部通过。第二轮31/35，四个新增测试误把异步持久化复选框视为同步，或要求首次保存后已折叠的按钮可见；按实际交互等待已保存状态，并增加profile及唯一原文断言，未削弱业务判据。新增6项先单独通过，再完成最终35项全量通过。

证据目录 `$WORKSPACE/life-os-local-ops/personalization-20261003/`：`check-final.log`、`e2e.log`、`e2e-personalization.log`、两轮失败日志/截图、`data-unchanged.json`、`candidate-sources.json`、`settings-desktop.png`、`settings-mobile.png`。最终提交身份与扫描结果见同目录 `result.json`。

新版独立预览为 http://127.0.0.1:4311 ，只使用该证据目录中的 `preview-data` 虚构样例；独立 `Start Personalization Preview.command` / `Stop Personalization Preview.command` 只管理这个新进程。原 http://127.0.0.1:4310 及原启动器保持旧编译版本和原数据，不因本轮源码提交自动切换。真实数据迁移与切换须另按[完整保全与候选验收流程](modules.md#完整文件保全与运行副本)决定。

本轮没有推送、修改remote/认证、交付新源码包或构建包。专业前端仍是显式组件，未引入任意动态前端执行；可信stdio插件仍无网络隔离。真实云连接器未实现，Watch自动连接仍延期。


## 2026-10-04 云端 B：发布扫描修复

业务基线 e6056782；独立分支 feat/cloud-release-learning-20261004，初始工作树干净。纯合成 Git 对照测试旧脚本 3/9 通过、6/9 失败：暂存/历史根隐私路径漏检、特殊文件名、浅历史、symlink、非Git退出语义；这不是发现真实隐私泄露。规则路径与来源标签现已分离，Git路径用NUL分隔，路径拒绝不读正文，Git/读取/浅历史/不支持入口失败返回2而非成功。发现规则返回1，完整无命中返回0。独立审查另复现忽略的祖先symlink越界读取，新增回归与逐层lstat拦截。

修复后专项10/10；此前聚合check（加入前9项）237/237、lint/typecheck/build通过。最终包含祖先回归的聚合与浏览器结果在后续收口追加。CI checkout fetch-depth:0，并在生产构建/E2E后执行release:scan；本轮尚无远程CI。扫描范围与排除项见README，保留旧扫描日志但旧结论受已发现漏检限制。旧公开CI通过不表示旧扫描器正确。

证据在本云执行器 /tmp/life-os-evidence：scan-before.log、scan-after.log、check-b.log、release-b.log、npm-ci.log。首轮npm ci因默认缓存目录不可写失败，指定独立/tmp缓存后200依赖安装成功；未改变锁文件或全局配置。直接匿名GitHub API受403限制，个人只读connector成功核验旧CI job，不修改凭据。独立审查显式请求gpt-6.1-sol/high、fork none，task_name gpt6_1_sol_high__release_review（工具未独立回显有效型号）。

B收口：最终 `npm run check` lint/typecheck、**241/241** 单元/集成/CLI（原228+扫描13，0 skipped）、生产构建全部通过；`LIFE_OS_PORT=4387 npm run test:e2e` **35/35 Chromium通过**（1.6分钟），未触本机4310/4311。`npm run release:scan`实际无配置命中；独立审查13/13复跑通过并关闭祖先symlink、replace/graft隐藏历史与缺失父目录三个发现。Git扫描显式忽略replace对象，legacy graft直接拒绝。最终日志check-b-final.log、e2e-b.log、release-b.log；没有本轮远程CI，也没有push。

## 2026-10-04 C：Obsidian 准备及临时目录路径兼容

本候选从B提交dc0b1a2创建独立工作树实施，由主代理唯一writer；A在另一工作树由指定代理独占，两候选停止写入后串行整合。Obsidian采用官方URI与现有Markdown机制：没有插件、后台watcher、系统注册写入或私人Vault合并。

`plugin-alias-before.mjs`在/tmp创建纯合成目录alias运行原插件，原编译版本返回“Plugin failed or returned incomplete protocol (exit 1)”。runner在mkdtemp后realpath，Node24仍只grant入口文件；新增test验证成功、其他文件/child/worker拒绝、既有网络边界与超时后清理。Obsidian单元/HTTP验证身份/权限、移动、未知frontmatter、外部正文及陈旧hash、删除/缺失/重复/身份改写/symlink拒绝。4/4定向通过。

首轮Chromium新增场景0/2：桌面实际发现refresh并发读取entities(v1)后conflicts捕获外部正文提升v2，重新打开仍拿旧version；改为先等conflicts完成再读取entities，避免旧UI快照。手机是新增测试错误把viewport外侧栏判为可点击，按既有“展开导航”操作修正测试。保留c-e2e-before.log/截图和c-e2e-diagnosis.log；未弱化冲突断言。修复后1440px/390px **2/2通过**，两尺寸截图实际查看；仅Chrome视口，不是手机硬件/Obsidian GUI。

独立只读审查显式请求gpt-6.1-sol/high/fork none，task gpt6_1_sol_high__interop_review；有效型号未独立回显。独立复跑4/4及diff检查通过，无具体阻断。Mac原生Obsidian与真实/var别名仍须后续验收；当前不动本机启动器或原运行数据。合成证据位于/tmp/life-os-evidence，以c-及obsidian-为前缀。最终聚合/浏览器结果在收口追加。

C最终 `npm run check`：lint/typecheck、**245/245**单元/集成/CLI、生产构建通过，0 skipped；`LIFE_OS_PORT=4389 npm run test:e2e` **37/37**（原35+新增2）通过，1.9分钟。`release:scan`无配置命中，diff检查通过。日志c-check-final.log、c-e2e-final.log、c-release.log。独立候选待与A串行整合后再做组合版本回归；不能将此数字当作尚未完成A的验收。

## 2026-10-04 A：量化学习闭环阶段验收

A基于B，在原业务候选由指定唯一writer实施；主代理独占PROGRESS。本地实现提交`c2eede0`包含结构化协议、schema2/3→4显式迁移、Store共享校验、API/CLI/UI与合成契约；未覆盖原个人目标。实际合成流程完成650→700配置历史、基线、多次练习、新题复测、样本不足、人工采纳/撤销及教师原文/摘要修订，不证明实际学习效果。

早期独立核心review和主代理探针发现并修复通用保存覆盖配置、sync改题身份、教师原文/来源修订绕过、后补录作答被误判重复、旧自定义同名类型被误套新协议、offset/IANA校验不一致。独立原反例闭合，父代理额外源修订及时间探针也已实际拒绝。新17项测试涵盖字段/关联/幂等、停用模块、删除恢复、schema第二阶段失败/重试、source receipts、关闭重开、实际backup/restore与真实loopback HTTP及CLI。

首次新增单元12项10通过2失败为测试误用Vault.path；改用read().path后通过，原日志保留。首次aggregate在lint两项失败；修复后通过。新浏览器最初datetime-local测试输入含被浏览器规范化的零秒，改用等价分钟输入而保留实际非UTC历史时间断言。完整浏览器前三轮均37/38：语言下拉框被旧helper当文本、选择了空placeholder、删除关联ID在390px溢出。修复真实非空控件选择和长标识换行；保留全部原业务断言，并增加删除状态布局和恢复UI就绪断言。失败日志与截图保留在a-e2e-final/complete/ready.log、a-e2e-first/second/third-results，未删失败或缩减分母。

最终 `npm run check` **258/258**（B241+学习17）、lint/typecheck/build通过；`LIFE_OS_PORT=4387 npm run test:e2e` **38/38 Chromium**（原35+学习3）通过，0 skipped；`npm run release:scan`无配置命中，diff干净。证据a-check-handoff.log、a-e2e-handoff.log、a-release-scan.log及a-loop-desktop.png/a-loop-mobile.png。writer已停止，主代理串行整合C为`9922d47`，保留conflicts捕获先于entities读取的屏障及两组样式；组合候选的独立整体review和最终结果另行追加。

## 2026-10-04 最终组合候选与本地交接

最终源码及测试提交为 `5ff449ee68cee908b0aa92b3901a74be2b62755e`，分支 `feat/cloud-release-learning-20261004`，业务祖先 `e6056782b30e4873197f289881b781549eb3918d`。后续交付提交仅补本文档和验收边界；完整交付HEAD、源码树、逐文件哈希及bundle/patch以交接manifest为准。

- `npm run check` **265/265**，0失败/0跳过，lint、TypeScript和生产构建全部通过（a-resolution-check-final.log）。组成是原228＋扫描13＋互操作4＋学习20。
- `LIFE_OS_PORT=4387 npm run test:e2e` **41/41 Chromium**，2.6分钟，桌面及390px视口（combined-e2e-final.log）。原35场景完整保留，增加学习4与Obsidian2。未触本机4310/4311。
- 独立整体review原配置分叉/跳号、停用reading新关联及teacher同步绕过全部实际拒绝、backup前后相等；最后合法teacher冲突原反例成功且剩余0，必要恢复/保护定向 **3/3**（combined-review-protection-final.log、combined-review-teacher-conflict-after.log、combined-review-resolution-targeted.log）。审查及实现者均已停止。
- 最终发布扫描覆盖工作区、index、当前HEAD原始可达历史/提交元数据与构建输出；以交付evidence/release-final.log的实际退出状态为准。扫描规则无命中不等于对全部未纳入数据作安全保证；其他refs、忽略的运行数据和仓库外文件不在范围。新增CI入口已接入，但**本轮没有新远程CI执行，也没有push**。

保留收口失败：c9b5a24完整浏览器40/41，第二次启用插件后测试提前展开旧卡，reload按state重挂载后详情收起；仅新增与第一次启用相同的“已启用”就绪断言，权限/超时/输出/卸载断言未删。日志combined-e2e-c9b5a24-failed.log及对应failed-results保全。独立review发现合法teacher新修订冲突无法incoming接受；进一步实际发现裁决后未保全losing operation使packet重放再次应用。现以已存来源操作、receipt和完整历史快照证明明确裁决，保全被拒操作再清冲突，最后保存accepted head。真实未解决冲突backup/restore、incoming/local、回传收敛、旧source重放、再次恢复及source3继续同步均验证。初轮游标测试构造失败和第二轮真实恢复失败保留a-resolution-unit-initial/second.log；未修改零写入/零新增验收语义。

完整历史bundle、从业务基线起的全部提交patch、manifest、逐源文件清单、通过日志及历史失败只在云工作区交付，不自动上传Library。交接工具必须实际验证bundle完整clone/fsck、patch重放精确源码树、干净安装构建和编译后CLI合成升级/重放/教师导入/备份恢复；最终结果写包内manifest和独立日志，失败不可标成功。所有数据均虚构，不证明真实学习效果。

下一阶段：Mac项目内原生Codex与既有cloud/Claude workflow双review、修复和复验后才按授权发布GitHub，云端再pull核完整SHA。Mac Obsidian GUI/系统URI/真实临时目录别名、Safari/真实手机、真实数据库Schema及主入口切换仍须本地验收；Watch延期。真实产品云sync提供方/账号/范围/设备/密钥未定。交易与研究新模块等待经Mac双review审定的计划，核对双方差异、祖先关系及唯一writer后以本候选顺序续接；当前无adapter、实盘、券商或真实个人数据接入。

## 2026-10-05 Mac 恢复续接与修复验证

本轮以独立工作树的 `dcaa738444579b7cc45c730b001cdf82ddcb19b6` 为交接基线，业务祖先仍为 e6056782；使用 Node24.19.0 与本机 Chrome154，数据均虚构。原 Claude run 的五阶段证据复用，恢复轮实际完成余下三个阶段；其原仓一致性检查因 Codex 同期追加 PROGRESS 失败，保留 failed，不冒充接受。修复后的再次独立核验状态见任务进度与本机交付 manifest。

- 完整 `npm run check` **281/281**、0失败/跳过，lint/typecheck/build通过；默认 macOS TMPDIR 下 workspace-copy 的9项全部通过，产品仍拒绝符号链接祖先。
- 完整 `npm run test:e2e` **42/42**、0跳过、2.4分钟；专用4396端口，桌面/390px仅是浏览器视口。保存成功但报告刷新失败的新增场景验证表单与operationId保留、重试后只有一次17分钟。
- 教师来源冲突同包/分包、incoming/local、未决bootstrap/restore、来源收据、伪造零写、裁决收敛及重放均有合成回归；目标停用后允许保留旧关联更正，新关联仍拒绝。教师外部正文改写保持失败关闭，新增提示和手工恢复诊断。
- 扫描新增HEAD可达提交正文及带连字符密钥格式；index/history内容、committer、symlink/子模块模式有回归。实际工作区/index/17提交及web-dist扫描通过；最终本地提交后的扫描另记交付日志。未检查其他refs/tag注释或私人运行数据，未执行远程CI。
- 保留首轮浏览器 **41/42**：唯一失败是手机设置测试的私有服务teardown超时，先关闭测试自己的browser context再关闭服务后完整通过，业务断言及45秒超时不变。新增回归初轮失败和临时预期纠正均保留，不修改正式验收。
- Obsidian控制器轻量检查 **5/5**；一次真实单实例小型验收在约3.15秒因连续RSS增长速率超过设定阈值停止，采样峰值525.72 MiB、日志1771字节、swap无增长。全部观察到的任务进程已清理且复查无Obsidian进程；**原生往返未通过，系统URI未测**。未降低停止标准或自动重试，软监视不等于OS硬上限，不能据此确认原故障的分配根因。

证据保存在本机仓库外私有证据目录（具体路径不入库），包含原始失败/通过日志、逐条审查裁决及RESOURCE_STOP；临时执行目录只作工作副本。没有push、部署、Library上传、真实数据迁移、主入口切换或Trader实现；交易计划的双审已由用户确认完成，本轮不重做。Safari/真机、真实云提供方及Watch等未授权/延期边界不变。

### Mac 最终诊断尾项

冻结修复 `0e7b0ae7a1c9b386a13411d2fe4a112b50b96f2a` 的Claude独立Workflow复审已交回并由Codex逐项裁决接受，原工作树未变；独立新增source-first裁决顺序 **4/4**通过。复审新增的网页诊断入口P3已作最小修复：受保护教师正文校验失败包含笔记ID/同数据CLI入口，启动错误不再一概归因服务未运行，文档明确失败时网页report不可达但CLI/认证HTTP可用。真实浏览器原反例失败保留；修后完整 `npm run check` **281/281**、lint/typecheck/build，以及 `npm run test:e2e` **43/43**、0跳过、2.5分钟通过。最后小差异的独立闭合与精确提交见本地manifest；不把旧42项报告当作新增场景证据。

资源停止解释补充：监视器无启动暖机区分，按整个进程树RSS求和（含Node harness/新Helper及可能重复计数的共享页），不是heap或唯一驻留物理内存。两个连续区间247/249ms测得256.77/1212.22 MiB/s，首个仅超阈值约0.3%，后一个进程数由2增至5，存在正常冷启动误判的明显可能。此次仅证明既定软监视与已观察进程清理触发，**不证明原事故重现或异常泄漏**；原生往返未通过、系统URI未测，阈值适用性仍未校准，没有重试或放宽保护。


2026-10-05诊断尾项复审：run-sGDM1NJ4kBGr_pbV真实单阶段Workflow完成并经Codex裁决，闭合原网页恢复入口问题。其两项P3收尾已补：启动错误在ready前不能关闭，保留重新连接；教师恢复提示依据原始错误，不一概指示恢复正文。旧版本浏览器反例明确失败，修后完整check **281/281**、0失败/跳过，lint/typecheck/build和Chrome E2E **43/43**、0跳过、2.5分钟通过；最终代码和日志哈希见本地tail-verification-binding。原生Obsidian仍未通过，无自动重试。


最终代码6caaa94958438d6fb40a67518f7a7afa966c8c40已由run-uPHDhym6M9BNIXwJ完成单阶段Workflow复核并由Codexaccepted，两项收尾closed，无新finding；281/43结果由代码文件/日志hash绑定，未冒称提交后重新测试。最终仅追加文档后打包，精确commit/tree、bundle/patch重放和最终release scan以本机delivery-manifest为准。12个已知条件/低优先级条目保留：邮箱P2是可能的远端PR合成commit扫描失败，不是当前分支传输或P0–P6合成开发的固有阻断；现行禁止push和远程身份核验仍独立有效。Obsidian原生未通过与Git门禁独立，未重试、未调整保护阈值；原始failed/blocked报告全部保存。

## 2026-10-09 第一批隔离修复（独立副本）

基线 `f76ea92` 工作树，Node 24.19.0，独立 npm cache，`npm ci` 未改锁文件。新增反例先在旧代码运行：`direct Store and restore callers cannot place data inside the repository` 失败（Missing expected exception）；6 项个人机器路径扫描用例失败、占位符用例通过。修复后 `tests/safety-regression.test.ts` 11/11、`tests/release-scan.test.ts` 29/29；完整 `npm run check`（lint/typecheck/test/build）**289/289**、0 失败/跳过。未在副本运行 Chrome E2E 或原生 App。

新版 `npm run release:scan` 在 `f76ea92` 完整历史上退出 1：`f76ea92`、`6caaa94`、`5d9c9e4`、`0e7b0ae` 的文档与当前未脱敏 index/PROGRESS 命中“个人机器路径”，输出只含类别与文件；同一脚本扫描 `e6056782` 历史退出 0。这是预期拒绝，未删历史或放宽规则；发布走脱敏交付链。

## 2026-10-09 第二批配置读取与跨 checkout 边界（独立副本）

Node 24.19.0；依赖按同一 `package-lock.json` 复制到副本（离线 `npm ci` 缺缓存），锁文件未改。对照先在旧源码（`cli.ts`/`server.ts`/`paths.ts` 取 `HEAD`，测试清理取上一轮版本）的临时副本运行合成场景：拼错 `agentScopes` 的 CLI 退出 0 并建库；符号链接 `config.json` 被跟随并导出同步包；其他 Life OS 源码 checkout 内的数据根被创建；FIFO `config.json` 让服务在建库后挂起至 8 秒超时；`direct Store` 测试的清理删除了仓库根下不属于它的 `.life-restore-*` 目录。新代码上述配置/路径场景均以退出码 1 在建库前拒绝，FIFO 约 0.14 秒拒绝，外来目录保留。

新增 `tests/config.test.ts` 6/6；完整 `npm run check`（lint/typecheck/test/build）**295/295**、0 失败/跳过。未在副本运行 Chrome E2E、原生 App 或全历史 `npm run release:scan`。

## 2026-10-09 第二批配置边界补漏（独立副本）

父任务复现了两个反例，均已修复，修复前后都在本副本中跑过。

1. `syncScope` 容器键拼错（如 `entitiez`）或 `entities` 为 `null`/假值时，原来被接受，selection 会静默变成整模块授权；现在拒绝，错误中不回显值。数组形式的旧 `syncScope` 和合法 selection 不变。
2. 直接调用 `initLocalConfig` 时，原来缺少路径保护，可以在当前仓库、其他 Life OS 源码 checkout 或 preservation-only 保全区内建立配置；现在函数本身在 `mkdir` 前复用 `outsideRepository` 与 `assertRunnableWorkspace`，拒绝时没有副作用。只有 `.git` 的笔记目录仍然允许。

新增的 2 个用例在修复前失败（Missing expected exception），修复后 `tests/config.test.ts` 与 `tests/safety-regression.test.ts` 共 19/19 通过，`npm run lint`、`npm run typecheck` 通过（Node 24.19.0）。本轮未跑完整 `npm run check`、E2E 或原生 App。

## 2026-10-09 开发依赖 shell-quote 漏洞修补（独立副本）

**问题**：父任务独立运行 `npm audit`，报 2 个 critical，二者是同一条链：`concurrently@9.2.4` → `shell-quote@1.9.0`（GHSA-pqg4-j6r4-53mv）。

**修补**：
- 在 `package.json` 增加 `overrides: { concurrently: { "shell-quote": "1.11.0" } }`。
- 用专用离线 npm cache 执行 `npm install --package-lock-only --offline`，锁文件只有 `node_modules/shell-quote` 一项的版本、resolved 和 integrity 发生变化。再执行一次，锁文件字节不变。

**验证**（Node 24.19.0 / npm 11.17.0）：
- 离线 `npm ci` 退出 0。`npm ls shell-quote` 显示 `concurrently@9.2.4` 下为 `shell-quote@1.11.0 overridden`。
- 用公告描述的输入形态（`{ comment }` 之后跟一个含换行的 token）只生成字符串，不执行 shell：
  - 1.9.0 输出包含裸换行的 `#note 'harmless⏎INJECTED_SECOND_LINE'`，第二行会被 shell 当作新命令；
  - 1.11.0 抛出 `TypeError: a token after a \`comment\` must not contain line terminators`。
- `concurrently` 用两个固定的 `node -e` 命令做 smoke，两条均以 0 退出。
- `npm audit --json` 结果：0 个漏洞（274 个依赖）。
- `npm run lint`、`npm run typecheck` 通过。

**未运行**：完整 `npm run check`、E2E 与发布扫描，由父任务在原件上执行。没有启动 `npm run dev`。


## 2026-10-09 父任务原件最终验证

Codex在整合worktree按最终锁重新执行Node24 npm ci，随后完整npm run check **297/297**、0失败/跳过，lint/typecheck/build通过；独立配置父反例2/2及quote非法换行拒绝/普通字符串引号保留通过，npm audit **0**。Chrome首轮在外层执行沙箱中43项均于browserType.launch失败（SIGABRT、kill EPERM），业务断言未运行，失败日志保留；运行环境批准后原样43项、1worker、45秒判据、4396虚构数据根与临时Chrome profile，完整npm run test:e2e **43/43**通过（2.7分钟）。未缩覆盖/改超时或正式断言。

本机三套既有数据共79文件指纹全未变；没有启动原生Obsidian、切换旧启动器或迁移私人数据。此前原生RESOURCE_STOP/not_passed与system URI/not_exercised保持。新交付从已公开e605历史的文档保全子提交a6ad8f4c建立，同最终审定tree、无旧私人路径祖先；全历史扫描与远端同步结果以实际交付manifest/Git引用为准，不把旧候选的扫描通过或失败直接替代新链验收。


GitHub实际验证收口：2eab7122e9aeb08bac093e8a34c3d50b3a11806c的[CI run37899479349](https://github.com/BryanYue/life-os/actions/runs/37899479349)全部success，npm ci/check/Chromium E2E/完整历史release:scan逐步通过。本地交付扫描128文件、index、12 HEAD祖先及提交元数据/正文与web-dist无配置命中。主目录和当前worktree源码同SHA、干净；远端空probe已保全并删除。旧含私人路径祖先仅留本机，main根/默认入口不变。本次随后仅将这些实际结果回写协调文档，业务源码/测试/锁文件不再改变，最终文档提交绑定以Git和.local/audits/consolidation-20261009/delivery.json为准。
