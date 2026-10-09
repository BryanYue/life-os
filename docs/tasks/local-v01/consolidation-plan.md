# 2026-10-09 整合、隔离与 Obsidian 完善计划

本文件是 local-v01 整合阶段的计划与职责说明，不是进度记录；状态与验证结论以 [PROGRESS.md](PROGRESS.md) 和 [validation.md](../../validation.md) 为准。文中不记录任何真实机器路径、账户名或私人数据位置，私人位置统一写作 `$LIFE_OS_HOME`、`$HOME` 或 `<user>`。

## 1. 分支与候选（阶段开始时快照）

| 引用                                              | 位置                    | 内容与用途                                                                                               | 处理                                                              |
| ------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `feat/local-life-os` @ `e605678`                  | GitHub 与本地           | 最新已发布业务分支；新版发布扫描全历史无个人机器路径命中                                                 | 作为干净交付链的父版本，只做快进                                  |
| `main` @ `7ebb56b`                                | GitHub                  | 仅初始 README，与业务根无共同祖先                                                                        | 保留；切换默认分支需单独的历史方案和用户决定                      |
| `test/cloud-sync` @ `9442965`                     | GitHub                  | 相对 `e605678` 的空提交，Git 推送探针，无独有代码                                                        | 无独有成果，可按用户清理要求删除                                  |
| `codex/lifeos-consolidation-20261009` @ `f76ea92` | 本地整合 worktree       | 已复核完整候选，比 `e605678` 多 11 个提交（学习闭环、Obsidian 准备、恢复修复等），最终业务代码 `6caaa94` | 完整保留在本地；其中 4 个提交的文档含个人机器路径，**不直接推送** |
| 云开发线程最后 HEAD `dcaa738`                     | 已包含于 `f76ea92` 历史 | 原云开发交接点                                                                                           | 无需单独同步                                                      |
| `658c` 旧候选 worktree                            | 本地                    | 架构只读审计的冻结来源                                                                                   | 只读保留                                                          |
| 主 checkout                                       | 本地                    | `e605678` + 未提交 PROGRESS 与两份交易研究规划文档                                                       | 原字节保留；文档按原内容提交进交付链                              |

交付策略：在 `e605678` 之上提交主 checkout 的任务文档，再把本阶段最终脱敏 tree 作为后续提交加入，完整 tree 比对、`npm run check`、Chrome E2E 和全历史 `npm run release:scan` 通过后只推送明确的业务 ref；不 `--all/--mirror`、不强推、不重写既有根。

## 2. 职责矩阵

| 层                                       | 权威                    | 位置                       | 进入 Git | 隔离保证                                                                                                                          |
| ---------------------------------------- | ----------------------- | -------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 通用源码、Schema、内置模块、合成样例     | 仓库                    | 仓库内                     | 是       | 发布扫描：私有文件类型/路径、凭据、备份载荷、非示例邮箱、非 noreply 元数据、个人机器路径（工作树/index/全历史/提交正文/构建产物） |
| 结构化当前状态、历史、启停、同步游标     | SQLite `life.sqlite`    | `$LIFE_OS_HOME`            | 否       | `Store` 构造与 `Store.restore` 入口统一经 `outsideRepository` 检查（含符号链接祖先，以及本机其他 Life OS 源码 checkout），拒绝时无目录/数据库/权限副作用 |
| 正文                                     | 专用 Vault Markdown     | `$LIFE_OS_HOME/vault`      | 否       | Vault 拒绝符号链接、重复 ID、根外路径                                                                                             |
| 个人偏好（语言、排序、分类名、模板偏好） | `personal-profile.json` | 数据根                     | 否       | `ProfileManager` 写前 `outsideRepository`；GET 不初始化                                                                           |
| 模板注册                                 | `templates.json`        | 数据根                     | 否       | 声明数据，不执行代码                                                                                                              |
| 私有声明式模块                           | `plugins/*.json`        | 数据根                     | 否       | 启动时注册；可执行模块必须先安装授权                                                                                              |
| 插件代码授权                             | `plugin-state.json`     | 数据根                     | 否       | 不进入逻辑备份；恢复不自动恢复授权                                                                                                |
| 服务配置（Agent 令牌、Agent/同步范围）   | `config.json`           | 数据根                     | 否       | 可选；服务授权唯一来源。服务/CLI 在打开 `Store` 前严格读取（拒绝未知顶层键、错误类型、非法 scope、符号链接/FIFO/目录/超大文件，错误不回显值），不存在时按空配置运行；`config init` 只显式生成新的 0600 文件、不覆盖、不授予 Agent/同步模块；`config show` 脱敏令牌 |
| 加密导出密钥                             | `LIFE_OS_KEY_FILE`      | 仓库外                     | 否       | 写前 `outsideRepository`                                                                                                          |
| 本机运行配套（专用 Node、启动器）        | 本机                    | 仓库外或被忽略的 `.local/` | 否       | 不写入源码或文档                                                                                                                  |

`.gitignore` 只是防误加的便利层，不作为运行隔离或无泄漏的证明；真正保证来自上面的运行时检查和发布扫描。

## 3. 现有动态配置生成与权限分离

- 首次运行：服务在 `$LIFE_OS_HOME`（默认 `~/.life-os`）创建 0700 数据根、SQLite、Vault 与 `plugins/`；`config.json` 不自动生成，存在时才读取。用户可运行 `npm run cli -- config init [--agent-token]` 显式生成空授权的 0600 `config.json`（只创建该文件及缺失的数据根目录，不建数据库/Vault/插件目录；令牌为随机值，不打印），再手动填写模块范围并重启服务；`config show` 输出脱敏后的当前配置。内置八领域模块由代码注册，`plugins/*.json` 中的私有声明式模块启动时注册（可执行模块未授权时拒绝启动），启停只由 SQLite 决定。
- 个人选择：profile、模板通过 API/CLI 显式写入，带 revision 校验；读取不生成文件，陈旧 profile 不会恢复插件授权。
- 私有模块：声明式模块 JSON 由 Schema 驱动动态表单；可信本地插件经安装、授权、启用三步，授权与数据分离存放。
- 升级/备份/恢复：Schema 升级显式执行；逻辑备份只含受管理实体及笔记；恢复只写入不存在的新目录（隔离校验后发布），插件授权需重新确认。
- 本阶段不新增配置权威、数据库、同步状态机或默认授权；上述机制继续复用。

## 4. 第一批（本轮）已实现

1. `Store` 构造和 `Store.restore` 复用 `outsideRepository`：直接调用、仓库内新目录、仓库内已有目录、经符号链接父目录指回仓库均拒绝，且仓库目录列表、已有目录内容与权限不变；仓库外首次生成与恢复正常（`tests/safety-regression.test.ts`）。
2. 发布扫描新增“个人机器路径”类别：识别具体账户名的 macOS/Linux 主目录与 Windows 用户目录，覆盖工作树、index、全历史 blob、提交正文和 `web-dist`；只输出类别和文件，不回显值；`<user>`、`$HOME`、`~` 占位不命中（`tests/release-scan.test.ts`）。原规则、完整历史、grafts/shallow 拒绝和 noreply 判据保持。
3. `.gitignore` 补充 `.local/`、根 `config.json`、`plugins/`、`backups/`、`.obsidian/`、`.DS_Store`。
4. 当前文档中的个人机器路径已脱敏。`f76ea92` 等历史提交里的旧路径仍在，完整扫描会如实拒绝该历史，这是预期防护。

## 4.1 第二批（本轮）已实现

1. `src/config.ts` 统一读取 `config.json`：`O_NOFOLLOW|O_NONBLOCK` 打开、`fstat` 确认普通文件、256 KB 上限；顶层只允许 `agentToken`、`agentModules`、`agentScope`、`syncModules`、`syncScope`，scope 复用 `validateEntityScope`/`normalizedScope`。旧实现把拼错的 `agentScopes` 静默忽略，Agent 退化为整模块访问；现在启动即拒绝。已有合法令牌（不限长度/格式）与整模块授权保持可用。服务与 CLI 四处读取改为同一函数，并在 `Store` 初始化之前执行；缺失配置的 CLI 同步命令从抛出 ENOENT 改为与服务一致的空授权。
2. CLI `config init [--agent-token]` / `config show`，见第 3 节。
3. `outsideRepository` 另识别本机其他 Life OS 源码 checkout（祖先目录同时有 `.git`、`package.json` 的 `name` 为 `life-os` 与 `src/paths.ts`），含经符号链接进入的路径；不新增登记库、不调用 Git 进程。只有 `.git` 的私人笔记仓库、其他名称的 Node 项目不受影响（`tests/config.test.ts`）。
4. `tests/safety-regression.test.ts` 的清理只删除本测试自己的随机前缀路径，不再遍历删除仓库根下所有 `.life-restore-*`。
5. 开发依赖：`npm audit` 报 2 个 critical，二者是同一条链 `concurrently` → `shell-quote@1.9.0`（GHSA-pqg4-j6r4-53mv，受影响范围 `>=1.8.4 <1.11.0`）。`package.json` 只为 `concurrently` 下的 `shell-quote` 加精确覆盖 `1.11.0`，锁文件只有这一个条目变化，没有全面升级，也没有执行 `audit fix --force`。`concurrently` 只出现在开发命令 `npm run dev` 中，生产服务不加载它。

## 5. 待实现缺口

| 缺口                                                        | 现状                                                                                                          | 后续                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 交付链与远端同步                                            | 已建立2eab712干净交付链，主checkout/本worktree/GitHub业务分支同SHA，工作树干净                                                                               | 已完成；旧候选/迁移包及原文档由本机bundle保全，后续以业务ref继续        |
| 远端 CI 与发布扫描                                | 2eab712的CI run37899479349已成功，check/E2E/release:scan全部实际通过，完整历史checkout | 已验证；正文协调更新不改变已验证业务代码                                   |
| `main` 与业务根无共同祖先                                   | 默认分支仍是 README                                                                                           | 需用户决定历史方案                                                             |
| 运行中服务的产物版本                                        | 本机主启动器仍指向旧编译产物，预览端口为 `e605678` 隔离产物                                                   | 切换入口前用完整文件保全与隔离恢复；需用户决定                                 |
| 真实深度使用                                                | 本机现有数据根内容与历史虚构验收快照一致，未承载真实日常数据                                                  | 用户在独立数据根试用后再迁移                                                   |
| Mac 原生 Obsidian 往返                                      | 单实例验收在资源软监视下停止（RESOURCE_STOP），系统 URI 未测                                                  | 见第 6 节                                                                      |
| Vault 全量扫描与单笔记全局阻断                              | 每次读取实体都遍历并解析整个 Vault（`list()` 为 O(N×M)）；任一外来坏 frontmatter、有效符号链接、重复 `life_id` 或托管笔记缺失会让列表/备份/同步导出整体失败；`.obsidian/`、`.trash/` 等隐藏目录也被遍历。复杂度来自读代码，**尚无真实规模耗时实测** | 先做只读诊断（列出问题笔记与路径）和单次操作内共享一次扫描结果，不建持久索引；列表“部分成功返回”与新删除/缺失恢复语义会改变既有失败契约，须单独 review 后实施 |
| 交易与研究 P0–P6                                            | 规划已双审，新 research contract、离线适配器、ResearchWorkspace 未落地；现有 `research.ts` 为 v1 外部结果记录 | 单独阶段按 [trading-research-plan.md](trading-research-plan.md) 实施，本批不做 |
| 通用 `importSource` 与 `pending_notes` 按 ID 删除的并发窗口 | 静态风险，未复现                                                                                              | 研究 P0 对照中验证                                                             |
| 真实云同步、Watch/Health、Safari/真实手机                   | 未实现或延期                                                                                                  | 需要 provider/账号/设备授权                                                    |
| 不可信插件 OS 网络隔离、附件二进制管理、自动备份            | 未实现                                                                                                        | 能力边界已在文档说明                                                           |

## 6. Obsidian 完善修复阶段

用户选择（2026-10-09）：先只在本机使用专用 Vault。不对该 Vault 配置 Obsidian Sync、iCloud/网盘或 Git 等文件级同步。原因是这类同步不受 Life OS 同步范围控制，`family` 等笔记会随文件一起上传；若以后需要，另行设计按模块分目录或排除策略。

前提：只复用官方 `obsidian://open?path=` 与 `obsidian://choose-vault`；同一私有专用 Vault（`$LIFE_OS_HOME/vault`），不建第二份数据、后台 watcher 或新同步库，不迁移、不合并旧真实 Vault，不写 Obsidian 注册表。每阶段失败即停在该阶段，保留原始证据。

### O1 数据保全（代码，合成数据）

- `.obsidian/` 配置与未知附件（**待实施边界，不是现有保证**）：当前 `Vault.files()` 递归遍历包括 `.obsidian/`、`.trash/` 在内的所有目录，并读取、解析其中的 `.md`，所以其中的异常笔记今天就会影响列表、备份和同步导出。目标边界是 Store、逻辑备份与恢复不把它们当作托管笔记，也不覆盖或删除它们，逻辑备份不包含它们（以差异清单向用户说明）。实施时需要旧/新可区分的反例：隐藏目录里的坏 frontmatter、带 `life_id` 的副本、`.trash` 中的已删笔记，以及与 Obsidian 历史笔记的兼容。不能机械跳过所有隐藏目录。`preserve-workspace` 完整文件保全则必须读取、复制并 hash 整个数据根，包含 `.obsidian/` 与附件，二者用途不同。
- `protectedTeacherOriginal`：教师原文在 Obsidian 中被改时，按既有冲突保留与 `recover-note` 恢复原文，启动提示保持到就绪。
- 边界反例：外部编辑、移动/重命名、旧表单覆盖、重复 `life_id`、删除、解析错误、符号链接笔记/目录各一例，旧行为与新行为可区分。
- 验收：合成单元/HTTP 测试 + 已有 Chrome E2E 的 Obsidian 场景不退化。

### O2 交互体验（Web，合成数据）

- 窄屏（390px）与键盘：“在 Obsidian 打开”入口可达、焦点顺序正确、外部编辑后刷新提示清晰。
- 验收：Chrome E2E 桌面与 390px 视口。

### O3 监视器静态测量与审查（不启动 App）

- 现有资源软监视按整个进程树 RSS 求和，无冷启动暖机区分，进程归属与共享页重复计数会放大读数；先静态审查这些测量口径并写出测量方案。
- **不改原 RSS 阈值、不加自动重启或重试**；新口径只能作为额外观测，原 RESOURCE_STOP 结论保留为“未通过”。

### O4 单实例原生验收（Mac）

- 只用新建虚构数据根和独立端口；原 4310/4311 及私人目录不动。
- 步骤：注册新 Vault → Life OS 写记录 → URI 打开并在 Obsidian 修改正文/未知属性、移动文件 → 刷新核对同 ID/新正文/关联 → 旧表单与重复 ID 提示 → 恢复。
- 停止：任一资源停止条件触发即停，清理本任务启动的全部进程并复查无残留；不重试同一配置。
- 回滚：删除虚构数据根与对应 Vault 注册；不影响私人数据。

## 7. 回滚边界

本阶段源码改动集中在 `src/store.ts` 入口检查、`scripts/release-scan.mjs` 新类别、`src/config.ts` 与 `src/paths.ts`/`src/server.ts`/`src/cli.ts` 的配置与边界接入、`package.json` 的 `shell-quote` 覆盖与对应锁条目、`.gitignore` 与文档；回退相应提交即可。旧候选、bundle、源规划文件和私人数据均未改动。


## 8. 本轮收口与后续执行顺序

父任务原件最终Node24 check297/297、Chrome43/43（含桌面/390px网页Obsidian合成往返）与audit0通过；旧沙箱Chrome启动失败及原生ObsidianRESOURCE_STOP分别保留。主checkout原未提交三文档已原字节保全至a6ad8f4c；本轮最终tree以干净交付子链同步业务ref，代码交付SHA为2eab712、CI run37899479349全部通过；本节状态文档后续提交及精确最终SHA以Git及仓外manifest为准。默认main待入口选择，仍是历史README。

接下来先按O1补只读笔记诊断、单次操作扫描与隐藏目录/损坏/删除/保全反例；保持现有严格列表、备份、恢复和权限契约，部分成功返回或新的恢复语义需先形成可审查契约。然后完成O2键盘/窄屏细节，O3只补测量与控制证据，最后O4单实例虚构Vault原生验收。各候选Claude唯一写代码，Codex同时审数据权威、授权、恢复职责、重复状态和真实产出；不把持久索引、第二份数据、watcher或框架改造当默认方案。原生通过后先体验阅读/学习→Obsidian编辑→刷新→冲突/恢复→备份往返，再另行迁移真实数据。交易研究双审规划保留，P0–P6尚未实施。
