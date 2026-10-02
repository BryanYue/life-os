# Life OS

本地优先的个人生活管理应用。React + TypeScript + Fastify + SQLite；Markdown 保存笔记正文。不需要 Obsidian GUI、付费 API 密钥或云账户。

**当前是可运行的 v0.1 本地版本，不是完整云端交付。** 八领域均提供创建、编辑、查询、关联、比较、复盘与回收站；同步只提供本地双副本模拟。源码与示例不包含真实个人资料。

## 在 Mac 安装和运行

需要 **Node.js 24.x**（开发验证版本 24.19.0）和 Git。`node:sqlite` 随 Node 提供，不需要单独编译 SQLite 扩展。首次安装依赖需要网络，安装和构建完成后日常运行不依赖网络。

当前远程发布因连接身份问题暂停，GitHub main 还没有本版源码。先下载本次交付的 `life-os-v0.1.bundle`，在文件所在目录执行：

```bash
git clone -b feat/local-life-os life-os-v0.1.bundle life-os
cd life-os
npm ci
npm run build
npm start
```

bundle 包含本地功能分支的完整已审查源码历史，不含运行数据或依赖目录。正确个人连接完成、功能分支发布后，也可从 `https://github.com/BryanYue/life-os.git` clone 并切换至相应功能分支；本次没有推送或创建 PR。

浏览器打开 **http://127.0.0.1:4310**。服务仅监听回环地址；关闭终端或 Ctrl+C 停止。不要将端口反向代理到公网。当前尚未在 Mac 原生环境实测；Linux 上完成安装、构建、API 与 Chromium 验证。

默认数据目录为 `~/.life-os`，包含 `life.sqlite`、`vault/`、`plugins/` 和本机 `config.json`。它们不在源码仓库中。要使用另外一个独立目录：

```bash
LIFE_OS_HOME="$HOME/.life-os-demo" npm start
```

其中的 `vault/` 子目录可作为 Obsidian Vault 打开；应用没有访问任何既有真实 Vault。只在其中编辑带 `life_id` 的笔记并保留该 ID。重命名/移动笔记可保留关联；删除、重复 ID、解析错误及外部并发改动会明确报错。

## 使用八个领域

- **生活规划**：方向、目标、行动和约束。时间规划支持多个目标及普通/加班/疲劳情境，保护固定时间和用餐、交通、准备、恢复、睡眠预留。只有点击采纳才创建计划。
- **运动健康**：训练、恢复、指标、疲劳自评；计划与事实可并排比较。手动来源 JSON 导入可重复去重；合成健康导出适配见下文。
- **阅读学习**：材料、进度、学习时段、知识笔记、输出和复盘；可关联项目。
- **AI / Agent 实践**：问题、里程碑、任务、版本化实验、评价和产出引用；推断与测试事实分开。
- **英语 / 日语**：独立目标、材料、听说读写、复习项；实际练习分钟按语言汇总，计划不混入。
- **量化研究**：数据来源/版本、假设、参数 JSON、代码版本、费用/滑点、结果和风险；两条实验可并排比较。没有实际回测执行或下单器。
- **资产财务**：账户分类、精确金额收支、资产负债快照、汇率记录；按币种和分类分别汇总实际收支。金额使用十进制字符串，未提供自动汇率换算。
- **亲属关系**：关系、日期、约定、互动与共同事项；家庭数据始终排除在模拟同步外，也不会自动联系他人。

每个领域均可写复盘并关联证据。记录的模块、类型、计划/事实/推断身份创建后不可改写；实际执行后另建事实关联计划。设置页可加入明确标注的虚构示例，或执行 `npm run cli -- demo`。

## 数据导入、备份与恢复

设置页可导出完整 JSON 备份、导入 `EntityInput` 来源记录及模拟同步包。导出文件包含私人记录时由用户保管；不要放进公开仓库。

```bash
# 仅使用仓库内明确标注的合成样例，不表示设备已联动
npm run cli -- import-health examples/health-export.json

# 输出路径必须是新文件；示例位置在仓库外
npm run cli -- backup "$HOME/life-os-backup.json"
# 恢复必须使用不存在的新目录，不覆盖运行中的数据库
npm run cli -- restore "$HOME/life-os-backup.json" "$HOME/.life-os-restored"
LIFE_OS_HOME="$HOME/.life-os-restored" npm start
```

恢复副本具有新的设备 ID，保留历史游标、操作 ID、来源去重状态和模块版本，标记为隔离恢复；没有自动上传。关闭旧服务后在新副本检查记录、关系与笔记，再决定正式使用哪个目录。未自动启用备份计划或保留期限。

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

测试数据放在系统临时目录，测试不会读取默认 `~/.life-os`。公开 CI 不加载仓库外插件。可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定已有 Chromium。

## 升级、回滚与卸载

1. 停止应用，先用当前版本导出备份。不要同步或复制正在运行的 SQLite 文件。
2. 更新到明确发布的代码版本，运行 `npm ci`、`npm run check` 后再启动。
3. 模块 Schema 升级使用显式迁移命令；迁移前自动保存仓库外备份，失败回滚 SQLite 与待写日志。具体示例见模块说明。
4. 无通用逆迁移。回滚时检出旧代码，并把旧备份恢复到新目录再验证。
5. 卸载先停止服务，删除源码目录即可移除应用。私人数据保留在独立数据目录；永久删除数据、导出备份和历史副本由用户单独处理，应用回收站不是永久擦除。

本项目尚未选定开源许可证；仓库公开可见不等于已授予开源许可。发布前还需用户确认许可证。真实云服务、密钥管理、Apple Watch 自动联动及外部研究仓库接入均未配置或验收。完整需求和剩余范围见[验收矩阵](docs/acceptance.md)与[验证结果](docs/validation.md)。
