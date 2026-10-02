# Life OS

本地优先的个人生活管理应用。React + TypeScript + Fastify + SQLite；Markdown 保存笔记正文。不需要 Obsidian GUI、付费 API 密钥或云账户。

**当前是可运行的 v0.1 本地版本，不是完整云端交付。** 八领域均提供创建、编辑、查询、关联、复盘与回收站，并有周期规划、健康对照、研究比较、精确财务等专项流程；同步以本地多副本手动交换验证。源码与示例不包含真实个人资料。

## 在 Mac 安装和运行

需要 **Node.js 24.x**（开发验证版本 24.19.0）和 Git。`node:sqlite` 随 Node 提供，不需要单独编译 SQLite 扩展。首次安装依赖需要网络，安装和构建完成后日常运行不依赖网络。

现有个人 GitHub 连接已验证具备仓库写权限，但云终端推送身份绑定尚未修正，远程发布仍暂停，GitHub main 还没有本版源码。先下载本次交付的 `life-os-v0.1.bundle`，在文件所在目录执行：

```bash
git clone -b feat/local-life-os life-os-v0.1.bundle life-os
cd life-os
npm ci
npm run build
npm start
```

已交付 bundle 固定于文档提交 `c513c613`，不含本次审查后的修复；后续可靠性修复与领域/插件扩展保存在当前本地功能分支，按用户偏好未重新打包。bundle 不含运行数据或依赖目录。正确个人连接完成、功能分支发布后，也可从 `https://github.com/BryanYue/life-os.git` clone 并切换至相应功能分支；本次没有推送或创建 PR。

浏览器打开 **http://127.0.0.1:4310**。服务仅监听回环地址；关闭终端或 Ctrl+C 停止。不要将端口反向代理到公网。当前尚未在 Mac 原生环境实测；Linux 上完成安装、构建、API 与 Chromium 验证。

默认数据目录为 `~/.life-os`，包含 `life.sqlite`、`vault/`、`plugins/`、本机 `config.json`，安装插件后还有 `plugin-state.json`。它们不在源码仓库中。要使用另外一个独立目录：

```bash
LIFE_OS_HOME="$HOME/.life-os-demo" npm start
```

其中的 `vault/` 子目录可作为 Obsidian Vault 打开；应用没有访问任何既有真实 Vault。只在其中编辑带 `life_id` 的笔记并保留该 ID。重命名/移动笔记可保留关联；删除、重复 ID、解析错误及外部并发改动会明确报错。

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
npm run release:scan  # 内容/暂存/可达历史和作者元数据检查
git config --local core.hooksPath .githooks  # 可选，本仓库提交前检查
```

测试数据放在系统临时目录，测试不会读取默认 `~/.life-os`。公开 CI 不读取用户的仓库外插件；插件测试只在临时目录复制仓库内虚构示例。可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定已有 Chromium。

## 升级、回滚与卸载

1. 停止应用，先用当前版本导出备份。不要同步或复制正在运行的 SQLite 文件。
2. 更新到明确发布的代码版本，运行 `npm ci`、`npm run check` 后再启动。
3. 模块 Schema 升级使用显式迁移命令；迁移前自动保存仓库外备份，失败回滚 SQLite 与待写日志。具体示例见模块说明。
4. 无通用逆迁移。回滚时检出旧代码，并把旧备份恢复到新目录再验证。
5. 卸载先停止服务，删除源码目录即可移除应用。私人数据保留在独立数据目录；永久删除数据、导出备份和历史副本由用户单独处理，应用回收站不是永久擦除。

本项目尚未选定开源许可证；仓库公开可见不等于已授予开源许可。发布前还需用户确认许可证。真实云连接器尚未实现，本轮验证通用本地协议；Apple Watch/Health 自动连接已明确延期，不属于本轮交付门槛。设备密钥管理及真实外部研究仓库接入未配置或验收。可信本地 stdio 插件有受限文件/子进程权限，但网络不隔离，不提供恶意代码沙箱。完整需求和剩余范围见[验收矩阵](docs/acceptance.md)与[验证结果](docs/validation.md)。
