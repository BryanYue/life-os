# Life OS

本地优先的个人生活管理应用。React + TypeScript + Fastify + SQLite；Markdown 保存笔记正文。不需要 Obsidian GUI、付费 API 密钥或云账户。

**当前是可运行的 v0.1 本地版本，不是完整云端交付。** 八领域均提供创建、编辑、查询、关联、复盘与回收站，并有周期规划、健康对照、研究比较、精确财务等专项流程；同步以本地多副本手动交换验证。源码与示例不包含真实个人资料。

语言模块可显式升级到 schema 4，使用结构化基线、练习/题目证据、新题复测和人工方法采纳；阅读与练习时长取并集，官方/模拟/练习分开，目标与教师原文修订保留历史。见[学习闭环契约与恢复](docs/learning-loop.md)。合成验收不证明学习效果，模块不自动连接语音、老师或提醒服务。

## 在 Mac 安装和运行

需要 **Node.js 24.x**（开发验证版本 24.19.0）和 Git。`node:sqlite` 随 Node 提供，不需要单独编译 SQLite 扩展。首次安装依赖需要网络，安装和构建完成后日常运行不依赖网络。

业务源码已在 GitHub `feat/local-life-os`；`main` 仍是初始 README，不是应用入口。2026-10-09 核验业务分支仍为 `e6056782`；本地整合候选的分支、交付链与剩余缺口见[整合计划](docs/tasks/local-v01/consolidation-plan.md)。可在不存在的新目录获取业务源码：

```bash
git clone -b feat/local-life-os https://github.com/BryanYue/life-os.git life-os
cd life-os
npm ci
npm run build
npm start
```

早期 `life-os-v0.1.bundle` 停在 `c513c613`；2026-10-03 Mac 使用的安全迁移包内 `life-os.bundle` 则停在 `5f1ff29`，两者不是同一版本。Mac 后续 UTC 日期修复为 `25a566f`；分类/个人配置已包含于远端业务基线 `e6056782`，两份旧 bundle 均不包含这些后续改动。后续学习闭环、Obsidian 准备与恢复修复已完成 Mac 双 review，但其旧提交文档含个人机器路径，不直接推送；发布前在 `e6056782` 之上建立脱敏交付链并通过全历史 `npm run release:scan`。不自动上传 Library。源码续接须包含最新提交及其历史；bundle 不包含运行数据库、Vault、个人配置或依赖目录。本机从 bundle clone 后的 origin 指向本地 bundle，不代表 GitHub 连接。

浏览器打开 **http://127.0.0.1:4310**。服务仅监听回环地址；关闭终端或 Ctrl+C 停止。不要将端口反向代理到公网。Mac 原生 Node24/Chrome 已有实测，最新版本与结果见[验证记录](docs/validation.md)，Safari/真实手机仍未验收。本机专用启动器放在仓库外，使用固定 Node24 和真实路径 TMPDIR；不要用全局 Node26 替代。候选插件运行器已规范化临时目录物理路径，合成路径别名验证通过；Mac 原生复验前仍沿用既有专用启动器。独立演练可显式设置 `LIFE_OS_PORT=4311`，仍仅监听回环地址。

默认数据目录为 `~/.life-os`，包含 `life.sqlite`、`vault/`、`plugins/`、可选的 `config.json`（Agent/同步授权，可用 `npm run cli -- config init [--agent-token]` 生成空授权的 0600 文件，`config show` 脱敏查看，改后重启服务），以及按需生成的 `personal-profile.json`、`templates.json`、`plugin-state.json`。数据目录必须在源码仓库外：服务、CLI 和直接调用 `Store`/`Store.restore` 都会拒绝仓库内路径（含经符号链接指回仓库的路径）以及本机其他 Life OS 源码 checkout 内的路径；`config.json` 含未知键、错误类型或不是普通文件时，服务和 CLI 在打开数据库前拒绝启动。要使用另外一个独立目录：

```bash
LIFE_OS_HOME="$HOME/.life-os-demo" npm start
```

其中的 `vault/` 子目录可作为 Obsidian Vault 打开；应用没有访问任何既有真实 Vault。设置页“与 Obsidian 使用同一份笔记”可查看此服务的专用 Vault 路径，并显式打开 Obsidian 仓库管理器。先在**同一台机器**选择“打开文件夹作为仓库”，注册该目录；应用不检测或修改 Obsidian 注册表，不自动合并旧 Vault。

已保存记录的编辑窗口可准备“在 Obsidian 打开笔记”链接，按当前 `life_id` 解析移动后的文件；仅使用官方 [Obsidian URI](https://help.obsidian.md/Extending+Obsidian/Obsidian+URI) 的 `open?path=`，不携带正文或追加/覆盖命令。先保存表单，再外部编辑；返回后刷新并重新打开记录。保留 `life_id`、`life_module` 与未知 frontmatter，重命名/移动笔记保留关联；删除、重复 ID、解析错误、路径符号链接与外部并发改动明确报错。这是手动 Markdown 互操作，没有后台 watcher/完整实时同步或专用插件。云端合成往返不能替代 Mac Obsidian GUI 验收。

## 分类、个人选择与模板

“数据与设置”中的个人配置提供通用分类、模块启停、语言选择、导航偏好和历史显示。语言独立于阅读学习；项目实践与研究分别容纳 AI/Agent 和量化能力，八个既有模块和全部记录身份保留。关闭模块阻止后续写入/插件执行，不删除历史，也不改变同步或 Agent 授权。基础阅读只要求启用阅读学习；词汇复习与语言目标另需语言模块。历史入口允许查看停用模块，已有关系与累计阅读事实保留。

个人偏好写在仓库外数据根的 `personal-profile.json`，带并发版本检查。首次读取从已有模块状态和语言选项推导，不自动写文件或增加任务；模块实际启停由 SQLite 清单保存，profile 中的模块列表只是快照，不能通过复制 profile 恢复插件授权。模块启停立即生效，偏好保存是独立操作。同步配置仍在 `config.json` 中单独控制。

既有 schema2 保持可用。增加韩语等非内置语言后，在设置页明确升级相关模块到 schema3，再使用新语言；升级保留旧中文值、自定义字段、笔记、停用选择及关联，不自动迁移正在使用的数据。停止学习某种语言只移除新建选项，编辑历史记录时保留原值。CLI 提供 `language-upgrades` 和 `upgrade-languages learning|languages`；原 `upgrade-builtin` 仍负责已知 schema1 到2。

模板包含版本、参数和计划初始值。选择模板后先预览，再明确采用；不会自动建立真实目标、完成事实或学习分钟。可以注册个人 JSON 模板，版本递增，旧实例不随模板升级改写；重复采用请求复用同一操作 ID 时不重复创建。私人模板保存在数据根 `templates.json`，不包含可执行代码。详细格式、CLI 和保全流程见[模块说明](docs/modules.md)。

## 使用八个领域

- **生活规划**：方向、目标、行动和约束。单日/跨周轮换，普通/加班/疲劳及自定义容量，已有跨领域目标关联；保护固定时间与餐食、交通、准备、恢复、睡眠。高级输入支持地点转移和 DST 偏移选择；容量缺口有解释，只有人工采纳才创建计划。周期复盘建议带实际证据，不自动改计划。
- **运动健康**：训练、恢复、指标、疲劳自评；按单位与主观/设备来源分别看趋势。计划对照区分已记录和已完成，歧义关联不重复计数；手动 JSON 与 Apple 导出 XML 解析、去重和修订，未与真实设备联动。
- **阅读学习**：兴趣原文、独立辅助解释、知识笔记、词汇、一次计时的跨目标阅读；清单打卡、应用内提醒、表达训练和进度回顾，可关联项目。
- **AI / Agent 实践**：问题、里程碑、任务、版本化实验、评价和产出引用；推断与测试事实分开。
- **英语 / 日语**：阅读理解优先，保留听说读写、复习与独立目标。语言与领域学习可共用一次阅读；法语为可选项，不自动添加目标或固定任务。
- **量化研究**：通过版本化 JSON 导入/比较数据、参数、代码、成本、滑点和结果；明确未运行计划、失败事实与成功事实，并关联原提案。这里记录外部结果，不执行回测或下单。
- **资产财务**：精确金额、币种/分类收支、账户资产负债快照、净资产历史。可按明确录入的直接汇率换算，显示汇率来源/日期；缺汇率时标为不完整，不混加币种。无自动行情、支付、转账或交易。
- **亲属关系**：关系、日期、约定、互动与共同事项；家庭数据始终排除在模拟同步外，也不会自动联系他人。

财务历史按 UTC 日期展示，快照按每账户最新事实计算；汇率不自动推导逆向或多跳价格。健康 XML 当前支持步数、心率和 Workout 时长，其他类型列为跳过；时间必须与用户指定 IANA 时区一致。DTD 只允许惰性的 HealthData ELEMENT/ATTLIST 声明，实体和外部资源一律拒绝，不访问网络。

每个领域均可写复盘并关联证据。记录的模块、类型、计划/事实/推断身份创建后不可改写；实际执行后另建事实关联计划。设置页可加入明确标注的虚构示例，或执行 `npm run cli -- demo`。

## 从一次阅读开始

1. 建立多个进行中的目标或长期方向，例如虚构的领域学习与语言目标；不必只保留一个。阅读工作区也允许暂不关联目标。
2. 保存自己有权导入的文字，填写来源和导入依据。支持技术文档、新闻、剧相关文字和社交文字；链接仅保存，不自动抓取网页。原文保存在独立 Markdown 正文中。
3. 记录一次阅读的实际分钟，可同时勾选多个目标。补充解释和词汇不会增加时长，也不会覆盖原文。解释以推断保存，需要自行核对；应用无需模型密钥，不会自动向外部模型发送文字。
4. 把后续动作加入清单，完成后打卡，误操作可撤销。应用内提醒支持延后和确认；打开或刷新应用时检查，不申请系统通知、不后台推送。提醒、打卡与表达记录均不伪造学习分钟。
5. 在表达训练中保留原稿，按需整理核心观点、分组理由和证据，比较整理前后。也可保存口头练习的文字记录；无录音或转录。结构反馈是可解释推断，不评定观点真伪，也不要求所有写作套固定格式。

首页会按已有目标和记录给出规则建议，显示理由与来源。未记录不代表没有完成；建议可忽略或编辑后明确采纳为计划，不自动完成任务或触发外部动作。学习回顾的总分钟按唯一阅读事实去重，各目标的覆盖时长不能相加成总时长。实际运行与手机验收见[验证结果](docs/validation.md)。

已有旧版本数据时先按界面提示显式升级 `learning` 和 `languages`。命令行也可执行：

```bash
npm run cli -- builtin-upgrades
npm run cli -- upgrade-builtin learning
npm run cli -- upgrade-builtin languages
```

两模块分别生成迁移前备份，完成一个后可重试另一个；这不是两模块联合事务。只接受已知原版 v1 清单，自定义清单拒绝覆盖。升级保留原文、未知 frontmatter、停用状态与私有源码标记；不会自动创建真实目标或启用语言任务。新空库直接使用 schema 2。回滚需使用旧代码并恢复迁移前备份到新目录。

## 数据导入、备份与恢复

设置页可导出完整 JSON 备份、导入 `EntityInput` 来源记录、交换增量包/当前 Schema 初始化基线/只读字段投影，并管理本地插件。导出文件包含私人记录时由用户保管；不要放进公开仓库。

```bash
# 仅使用仓库内明确标注的合成样例，不表示设备已联动
npm run cli -- import-health examples/health-export.json
npm run cli -- import-apple-health examples/apple-health-export.xml UTC synthetic-example
npm run cli -- import-research examples/research-result.json

# 输出路径必须是新文件；示例位置在仓库外
npm run cli -- backup "$HOME/life-os-backup.json"
# 恢复必须使用不存在的新目录，不覆盖运行中的数据库
npm run cli -- restore "$HOME/life-os-backup.json" "$HOME/.life-os-restored"
LIFE_OS_HOME="$HOME/.life-os-restored" npm start
```

恢复先在临时目录验证全部必需表、实体 Schema、笔记与索引、关联和路径；无效备份不发布目标目录，修正后可使用同一路径重试。保留受管理笔记的相对路径。恢复副本具有新的设备 ID，保留历史游标、操作 ID、来源去重、只读投影和模块版本，标记为隔离恢复；没有自动上传。可执行插件恢复为停用，代码及信任授权不随数据备份恢复，需重新安装和授权。关闭旧服务后在新副本检查记录、关系与笔记，再决定正式使用哪个目录。未自动启用备份计划或保留期限。

可选的 CLI 加密导出采用 AES-256-GCM。以下命令只创建本机文件，不连接云服务；浏览器备份和不带 `-encrypted` 的命令仍是明文。运行目录、CLI 备份/同步输出、恢复目标与密钥路径均拒绝位于源码仓库内（含现有父目录符号链接）。

```bash
npm run cli -- keygen "$HOME/.life-os-export.key"
export LIFE_OS_KEY_FILE="$HOME/.life-os-export.key"
npm run cli -- backup-encrypted "$HOME/life-os-backup.sealed.json"
npm run cli -- restore-encrypted "$HOME/life-os-backup.sealed.json" "$HOME/.life-os-restored-sealed"
```

密钥文件为 32 字节随机密钥，权限需为 `600`，不会显示在日志中。请单独安全保管密钥副本，**丢失密钥就无法解密**；不要把密钥与导出包一起发送。共享密钥只证明持有该密钥，尚不提供每设备身份、撤销、轮换或 Keychain。SQLite、Vault 和自动迁移备份仍是本机明文。

如果崩溃后又在外部修改了待写入笔记，启动会保留两边内容并报告实体 ID。以下是明确的人工恢复选择；未选择版本保存在数据根目录的 `note-conflict-*.md`：

```bash
npm run cli -- recover-note ENTITY_ID external
# 或：npm run cli -- recover-note ENTITY_ID pending
```

## 扩展与开发

[模块协议](docs/modules.md)说明植物养护及仓库外私有模块；[架构](docs/architecture.md)解释时间、权限、审计和 Markdown；[同步说明](docs/sync.md)说明模拟协议、游标、冲突与限制。

```bash
npm run cli -- register examples/plants.json
npm run dev           # API 4310，开发界面 5173
npm run check         # lint、typecheck、单元/集成、生产构建
npx playwright install chromium  # 无系统 Chromium 时，仅测试需要
npm run test:e2e      # 临时虚构数据库 + 生产服务 + 浏览器
npm run release:scan  # 工作区、暂存区、HEAD 可达完整历史/元数据、web-dist
git config --local core.hooksPath .githooks  # 可选，本仓库提交前检查
```

发布扫描须有完整历史（CI checkout 使用 `fetch-depth: 0`），在构建/浏览器检查后运行。它检查已跟踪及未忽略文件、暂存 blob、HEAD 可达提交正文及作者/提交者 noreply、存在时的 `web-dist`；不检查其他 ref、tag 注释、忽略的运行数据或仓库外文件。路径命中隐私规则时不读正文，拒绝符号链接/子模块/未合并索引；退出 0 表示无配置命中，1 表示发现，2 表示扫描不完整。模式不能证明无私人信息，发布仍需人工核对。

测试数据放在系统临时目录，测试不会读取默认 `~/.life-os`。公开 CI 不读取用户的仓库外插件；插件测试只在临时目录复制仓库内虚构示例。可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定已有 Chromium。

## 升级、回滚与卸载

1. 停止应用，先用当前版本导出备份。不要同步或复制正在运行的 SQLite 文件。
2. 更新到明确发布的代码版本，运行 `npm ci`、`npm run check` 后再启动。
3. 模块 Schema 升级使用显式迁移命令；迁移前自动保存仓库外备份，失败回滚 SQLite 与待写日志。具体示例见模块说明。
4. 无通用逆迁移。回滚时检出旧代码，并把旧备份恢复到新目录再验证。
5. 卸载先停止服务，删除源码目录即可移除应用。私人数据保留在独立数据目录；永久删除数据、导出备份和历史副本由用户单独处理，应用回收站不是永久擦除。

本项目尚未选定开源许可证；仓库公开可见不等于已授予开源许可。发布前还需用户确认许可证。真实云连接器尚未实现，本轮验证通用本地协议；Apple Watch/Health 自动连接已明确延期，不属于本轮交付门槛。设备密钥管理及真实外部研究仓库接入未配置或验收。可信本地 stdio 插件有受限文件/子进程权限，但网络不隔离，不提供恶意代码沙箱。完整需求和剩余范围见[验收矩阵](docs/acceptance.md)与[验证结果](docs/validation.md)。
