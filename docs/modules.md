# 模块与迁移

核心使用同一 `Module` 契约装载公开和私有声明式模块（见 `src/types.ts`）。`codeVisibility` 只说明源码归属选择，不表示记录被发布。所有记录默认本机保存。家属记录即使代码是公开通用实现，也不进入同步。

基础契约：`id`（可命名空间）、`name`、`version`、`coreApi: 1`、`schemaVersion`、`enabled`、`codeVisibility`、多个 `entityTypes`（字段）、`relations`（目标模块及数量上限）、`views`（form/list/timeline）。已有字段包括 text、number、select、decimal、date，生成 JSON Schema 校验；未知字段拒绝。关系以稳定实体 ID 保存，可跨领域。人类写入与 Agent 范围由核心能力接口检查。`Module.contract` 是可选扩展，旧声明式模块仍可注册；插件安装必须提供下述完整契约。

## 增加植物养护

```bash
npm run cli -- register examples/plants.json
```

重新打开界面即可使用植物、养护记录和复盘，并关联费用、时间线、目标；不修改核心业务代码。另一种注册方式是在仓库外 `LIFE_OS_HOME/plugins/` 放置该 `Module` JSON，启动时装载未注册模块。这是声明模块注册目录，不是可执行插件安装目录；不要把含 `protocol/module/entry` 外层封装的插件清单放进这里。私有模块使用同样格式并设置 `codeVisibility: "private"`，位于仓库外或独立私有仓库；不把其 URL、名称、配置复制到公开 CI。本地示例不连接真实私有仓库。

本版启动时不会按清单变化自动修改已注册 Schema。停用接口 `POST /api/modules/:id/enabled` 控制后续业务写入与插件执行，不删除历史数据。该入口与 PluginManager 共用依赖和执行授权检查；普通注册不能启用带 contract 的模块。模块清单变更必须用显式迁移。

## 分类与个人配置

公共分类与存储模块分离：planning/health/learning/projects/language/research/finance/family 分别对应规划、健康、学习、项目实践、语言、研究、财务、亲属。既有 `languages` 和 `quant` ID 保持，分别展示在 language 与 research 分类下。未知模块继续保留，可在个人设置中归类；分类和标签变更不重写任何实体或 Markdown 身份。

`GET /api/profile` 读取仓库外 `personal-profile.json`，无文件时从当前清单推导默认值，不写文件。`POST /api/profile` 接受 `{patch, expectedRevision}`；revision 不匹配返回冲突，坏配置拒绝且不重置旧文件。主要字段为 `languagePreferences: {activeCodes, customLanguages?: [{code,name}]}`、`navigation: {order,labels,moduleCategories}`、`templatePreferences: {enabledIds}`、`history: {includeDisabled}`。分类排序/标签引用分类 ID，moduleCategories 从模块 ID 映射到分类 ID。

SQLite `modules.enabled` 是实际启停状态的唯一权威。返回的 profile.modules 是当前状态，保存文件中的模块映射只是当时快照；改变它不会启用模块，必须使用模块启停入口。这样不把文件偏好与 SQLite 双写假装成天然原子事务。插件启用仍需安装、有效授权、代码信任（stdio）和依赖；停用不能作为隐私权限或同步授权。历史列表仍能读取停用记录，常规新建及运行入口隐藏/拒绝，建议仅使用启用模块。

CLI：`profile show`、`profile update PATCH_JSON EXPECTED_REVISION`、`modules list`、`modules enable|disable ID`、`categories`。私人配置和模板不在 Store 逻辑备份、bootstrap 或增量同步内；恢复业务数据不自动恢复机器执行授权。profile 更新采用排他锁和原子文件替换；中断留下锁时保留旧文件并可见拒绝，需要先确认无配置写入者，再处理遗留锁，不自动猜测并覆盖。

例如下面是提交到 `POST /api/profile` 的虚构偏好请求。先读取当前 revision 替换示例中的0；它不创建目标，也不改变模块启停。项目实践与量化是否启用，分别通过 `modules enable|disable projects`、`modules enable|disable quant` 明确设置。

```json
{
  "expectedRevision": 0,
  "patch": {
    "languagePreferences": {
      "activeCodes": ["en", "ja", "ko"],
      "customLanguages": [{ "code": "ko", "name": "韩语" }]
    },
    "navigation": {
      "order": [
        "planning",
        "health",
        "learning",
        "language",
        "projects",
        "research",
        "finance",
        "family"
      ],
      "labels": { "language": "语言" },
      "moduleCategories": { "languages": "language", "quant": "research" }
    },
    "templatePreferences": { "enabledIds": ["reading.basic"] },
    "history": { "includeDisabled": false }
  }
}
```

## 任意语言与显式升级

语言目录提供稳定 code 与显示名，已有英语/日语/法语中文值保持。个人 activeCodes 只控制新建选择，不缩小历史存储范围，不创建目标。新语言用规范化语言 code，例如 `ko`，显示名可由个人目录配置。阅读报告把旧别名和 code 按同一身份汇总，同一个学习事实只计算一次。

默认既有 schema2 不自动变更；`GET /api/languages` 返回目录与待升级项，`POST /api/languages/upgrade {module}` 或 CLI `upgrade-languages learning|languages` 显式进行2→3。该升级只把相应 language 字段扩为可保存 code 的文本，保留自定义字段、原语言值、私有标记和停用状态。schema1 先走既有1→2升级；两个模块分别迁移并各自备份，不声称联合事务。未知新版本拒绝自动猜测。旧字段无需改名，模块/类型/性质/实体 ID 保持。

基础阅读材料与计时仍在 learning，语言目标与词汇在 languages。只启用 learning 时可阅读、解释和记录唯一时长；语言模块停用时词汇新建拒绝，既有词汇与关系保留。仅更改模块清单不等于实现动态前端插件：专业 UI 仍为公共源码中的显式组件。

## 声明式模板

`TemplateDefinition`（src/templates.ts）包含 `id`、正整数 `version`、`name`、`requires`、`parameters`、`target` 与 `defaults`。target 必须是 `kind: plan`、`status: draft|active`。参数支持 text/number/select、必填、默认值与范围；defaults 的 scalar 可以写 `{parameter: "key"}`，不执行表达式、脚本或字符串插值代码。生成的实体仍通过 Store 的字段、关系、权限和版本校验。成果字段与学习分钟不允许预填。

```json
{
  "id": "personal.reading-plan",
  "version": 1,
  "name": "自选阅读计划",
  "requires": ["learning"],
  "parameters": [
    { "key": "title", "label": "计划标题", "type": "text", "required": true }
  ],
  "target": {
    "module": "learning",
    "type": "checklist-item",
    "kind": "plan",
    "status": "draft"
  },
  "defaults": {
    "title": { "parameter": "title" },
    "fields": { "focus": "理解主要观点" }
  }
}
```

`GET /api/templates` 返回公共与个人模板及可用状态；`POST /api/templates/register {template}` 注册个人模板；`POST /api/templates/preview` 接收 `{templateId,version?,parameters?,occurredAt,timeZone}`，只预览；`POST /api/templates/apply` 再带 `operationId` 才明确写入。CLI 对应 `templates list`、`templates register|preview|apply JSON_FILE`。注册文件是仓库外 `templates.json`，排他锁防止服务/CLI同时注册丢更新；同ID/版本不同内容拒绝，升级必须提高版本。重试已成功操作返回当前记录，不回退后续编辑，也不因为模板升级或记录被删除而重复创建。模板文件/文本不授予插件权限。

## 完整文件保全与运行副本

Store 逻辑备份只包含受管理内容，不能替代未知笔记、附件、私人配置和代码的完整保留。CLI `preserve-workspace SOURCE NEW_TARGET --offline-confirmed` 要求先停止全部写入者，目标必须不存在；对符号链接、特殊文件、套叠路径和非空 WAL 拒绝。复制所有普通文件并校验源稳定性，失败不发布半成品。

该命令生成仅作保全的 `archive/` 目录及说明，不能作为运行数据根。私人插件授权只在原样保全区留存，不会作为运行授权恢复。当前 server/CLI 会拒绝启动保全根和其归档子树；旧代码不认识该标记，使用者也不得把旧服务指向它。双遍内容校验不能代替停止写入者。本轮只用虚构目录验证此流程，不自动复制、迁移或切换既有运行数据。

将来切换已有数据时按以下阶段验收，不能用新版源码已通过测试替代数据迁移验收：

1. 记录原代码提交、实际数据根和全部写入者；明确停机后完成完整文件保全及逐文件 hash 清单。保全区包含未知笔记、附件、私人模板/配置和旧插件授权，但始终不能运行。
2. 从受管理内容的逻辑备份恢复至另一个不存在的候选目录，获得独立设备身份；逐项对照实体、正文、关系、历史、冲突、来源收据、游标和删除标记。原目录、完整保全区和迁移前逻辑备份均保留。
3. 对逻辑备份未覆盖的每个文件列出归宿；未知文件原样保全，只有确认用途后才复制到候选中的原相对路径，碰撞时停止，不覆盖。个人 profile/templates 可单独核验后导入；同步范围和 Agent 授权重新核对；可执行插件不得复制旧授权作为运行配置，须重新安装与明确授权。
4. 在候选目录显式升级语言 Schema，检查旧字段值/私有标记/停用选择不变，以及新语言、基础阅读、唯一计时、模板预览和采用。升级失败保留候选用于诊断，从原备份恢复新的候选，不猜测逆向转换。
5. 提交源与候选差异、文件归宿清单及实际验收证据，再由用户决定切换数据根。切换后不允许旧新两个写入者同时操作同一数据库；回滚指向完整保留的原目录与匹配代码，新期间数据另行保全并核对，不能丢弃。

## Schema 升级

内置 `learning` 和 `languages` 从原版 schema 1 升至 schema 2，新增阅读、清单、提醒和表达等数据类型。运行 `npm run cli -- builtin-upgrades` 查看，再分别执行 `npm run cli -- upgrade-builtin learning` 与 `npm run cli -- upgrade-builtin languages`；界面提供同一人工升级入口。清单须与已知旧版本一致（允许保留 enabled/codeVisibility 的本机选择），自定义清单及未知版本拒绝覆盖。升级为可重试的单模块迁移，各自保存备份；不会自动启用停用模块、改变私有标记或增加目标。

所有关联使用既有稳定 ID；阅读分钟只保存在 `learning/session` 事实中。解释为独立推断，词汇为复习记录，打卡为事实，清单/提醒为计划；表达原稿、修订和结构反馈各有明确来源。其他模块无需升级即可关联这些记录。已有同步副本须显式完成对应迁移，空副本可按当前 Schema bootstrap。

假设从植物 v0.1.0/schema 1 的 `waterMl` 改为 v0.2.0/schema 2 的 `waterMillilitres`：准备新清单及 `{"waterMl":"waterMillilitres"}` 重命名映射文件，再执行：

```bash
npm run cli -- migrate /outside-repository/plants-v2.json /outside-repository/renames.json
```

每次只前进一个 Schema 版本。先生成数据目录中的 `migration-backup-*.json`；在同一 SQLite 事务中更新清单、校验和迁移所有记录、追加日志。任何记录失败整体回滚；笔记写入由恢复日志处理。失败/成功/备份恢复路径已有实际测试。需要回退时把迁移前备份恢复到新目录，而不是猜测逆转换。

当前迁移器支持字段重命名和校验性升级；复杂转换需实现受审查的专门适配器。插件管理器的 Schema 升级复用此迁移器，具体授权及失败行为见下文。

植物→养护→费用→复盘与自动表单/关系/时间线已有本地流程。内置示例生成器只处理启用的内置模块，不要求自定义模块拥有 `goal` 或 `supports`。跨 Schema 同步与历史初始化另见[同步说明](sync.md)；本机迁移和恢复不表示已经接入真实云端插件分发。

## 插件契约

源码定义见 [`src/module-contract.ts`](../src/module-contract.ts) 和 [`src/plugins.ts`](../src/plugins.ts)。插件清单的外层形状为 `{ protocol: 1, module: Module, entry?: string }`；`module.contract` 必填，`entry` 仅在需要本地 stdio 代码时使用。公开和仓库外私有清单执行相同校验与授权协议，`codeVisibility` 不扩大权限。

```typescript
type ModuleContract = {
  protocol: 1;
  core: {
    api: 1;
    minVersion: string;
    maxVersionExclusive?: string;
  };
  permissions: {
    id: string;
    action: "read" | "suggest" | "write" | "external";
    module: string;
    entityTypes?: string[];
    fields?: string[];
  }[];
  operations: {
    id: string;
    permissions: string[];
    handler: "list" | "suggest" | "write" | "patch" | "external" | "stdio";
  }[];
  importers: {
    id: string;
    operation: string;
    format: "json" | "text";
  }[];
  dependencies: {
    module: string;
    minVersion: string;
    maxVersionExclusive?: string;
  }[];
  migrations?: {
    fromSchema: number;
    toSchema: number;
    renames: Record<string, string>;
  }[];
};
```

版本使用数字 `major.minor.patch`，范围下界包含、上界不包含；当前核心版本为 `0.1.0`、API 为 `1`。校验器拒绝不兼容核心、重复键、未知操作权限、与 handler 不匹配的权限、未知实体类型或字段、无效导入器、自依赖及无效迁移映射。跨模块权限必须声明目标模块依赖；安装检查依赖存在和版本，启用及调用还检查依赖启用状态。循环依赖、破坏依赖方版本范围的升级，以及存在启用依赖方时的停用或卸载均拒绝。

`fields` 指实体的领域字段键，不代表正文、来源或关系。插件读结果只包含基本记录信息与获准领域字段，隐藏正文、来源、关系及 `noteHash`。操作只能使用自己的 `permissions` 引用中已授权的权限。默认授权只选择清单声明的 `read` 和 `suggest`；安装本身不给权限，启用前仍须显式 `authorize`。`suggest` 只能创建新的 `inference/draft`，不能改写事实或已有计划。`write` 必须在授权文件中明确列出；`external` 即使列入授权也始终被本地策略拒绝。

声明式 handler 直接经核心 broker 执行：`list` 读取获准记录，`suggest/write` 接受 `SaveRequest`，`patch` 接受 `{ id, fields, expectedVersion }` 并只合并获准字段。字段补丁保留隐藏字段、正文、来源和已有关系，同时检查版本及提交时 Markdown 哈希。完整 `SaveRequest` 不能借遗漏字段删除未授权字段，新关系写入当前拒绝。导入器把 JSON 解析结果或原始文本交给已声明操作；导入文本不会自动安装插件、批准权限或启动代码。

## 安装、授权与调用

使用虚构样例 [`examples/plugin-plants`](../examples/plugin-plants/manifest.json)。以下命令在仓库根目录执行，只创建临时演示目录；运行清单与代码必须先复制到仓库外，且与私人数据目录分开。路径按真实路径检查，目录符号链接不能绕过仓库边界。

```bash
export LIFE_OS_HOME="$(mktemp -d /tmp/life-plugin-data.XXXXXX)"
LIFE_PLUGIN_CODE="$(mktemp -d /tmp/life-plugin-code.XXXXXX)"
cp -R examples/plugin-plants/. "$LIFE_PLUGIN_CODE/"

npm run cli -- plugins install "$LIFE_PLUGIN_CODE/manifest.json"
npm run cli -- plugins authorize demo.plugin-plants
npm run cli -- plugins enable demo.plugin-plants
npm run cli -- plugins invoke demo.plugin-plants list
npm run cli -- plugins list
```

此授权允许样例的 `read-plants/suggest-plants`，不会运行 `plugin.mjs`。可在代码目录另存一个虚构建议输入文件，例如 `draft.json`：

```json
{
  "entity": {
    "module": "demo.plugin-plants",
    "type": "plant",
    "title": "Fictional fern",
    "kind": "inference",
    "status": "draft",
    "occurredAt": "2030-04-01",
    "timeZone": "UTC",
    "fields": { "nickname": "Fictional fern", "waterMl": 30 },
    "relations": [],
    "body": "Synthetic fixture only"
  },
  "expectedVersion": 0
}
```

```bash
npm run cli -- plugins import demo.plugin-plants draft-json "$LIFE_PLUGIN_CODE/draft.json"
npm run cli -- plugins invoke demo.plugin-plants list
```

如需编辑已有虚构记录，另存 `write-grants.json`，内容为 `{"permissions":["read-plants","suggest-plants","write-plants"]}`，执行 `plugins authorize demo.plugin-plants "$LIFE_PLUGIN_CODE/write-grants.json"`，再执行 `plugins enable demo.plugin-plants`。重新授权会先停用模块。将实际记录 ID 和当前版本填入 `patch.json`，例如 `{"id":"RECORD_ID","fields":{"waterMl":45},"expectedVersion":1}`，然后执行 `plugins invoke demo.plugin-plants patch "$LIFE_PLUGIN_CODE/patch.json"`。ID、版本或字段范围不匹配会拒绝。

CLI 参数中的授权和操作输入均为 JSON **文件路径**，不是内联 JSON 字符串：

| 操作                     | CLI                                                                 |
| ------------------------ | ------------------------------------------------------------------- |
| 查看状态、授权与失败事件 | `plugins list`                                                      |
| 安装 / 升级              | `plugins install MANIFEST` / `plugins upgrade MANIFEST`             |
| 授权                     | `plugins authorize ID [AUTHORIZATION_JSON_FILE]`                    |
| 启用 / 停用 / 卸载       | `plugins enable ID` / `plugins disable ID` / `plugins uninstall ID` |
| 调用操作                 | `plugins invoke ID OPERATION [INPUT_JSON_FILE]`                     |
| 调用导入器               | `plugins import ID IMPORTER TEXT_FILE`                              |

本地 API 提供相同入口；必须使用真人本地会话，POST 还需 `x-csrf-token`。Agent Bearer 凭据不能管理或调用这些插件入口。沿用应用的 `/api/session` 会话流程，勿把会话凭据写进清单。

| 方法与路径                                               | JSON 请求体                                       |
| -------------------------------------------------------- | ------------------------------------------------- |
| `GET /api/plugins`                                       | 无；响应包含状态列表和运行限制                    |
| `POST /api/plugins/install`、`POST /api/plugins/upgrade` | `{ "path": "/outside-repository/manifest.json" }` |
| `POST /api/plugins/:id/authorize`                        | 授权对象，默认为 `{}`                             |
| `POST /api/plugins/:id/enable`、`disable`、`uninstall`   | 无                                                |
| `POST /api/plugins/:id/invoke/:operation`                | `{ "input": ... }`                                |
| `POST /api/plugins/:id/import/:importer`                 | `{ "text": "待解析的虚构文本" }`                  |

## 升级、停用、卸载与恢复

安装保存已校验清单和代码哈希，注册禁用模块，不执行入口。升级要求提高模块版本；改变实体或关系 Schema 必须提高 `schemaVersion`，并提供对应的一步 `migrations` 声明。例如字段重命名使用 `{"fromSchema":1,"toSchema":2,"renames":{"waterMl":"waterMillilitres"}}`，同时更新实体字段及权限字段列表，再执行 `plugins upgrade /outside-repository/new-manifest.json`。Schema 升级调用 `Store.migrateModule`，生成迁移前备份；成功后模块停用、清除授权与代码信任，须重新授权和启用。同 Schema 升级也要求重新授权，不允许偷偷改变实体或关系结构。

有启用中的依赖者时，在迁移前拒绝升级。撤销授权的私人配置在 SQLite 提交前持久化：配置尚未成功保存时失败，数据库、实体与操作历史回滚并保留原授权；配置已保存后若 SQLite COMMIT 或笔记恢复失败，保留已撤权的执行门禁并明确提示恢复。SQLite 与文件系统没有共同事务，因此不宣称所有中断都回到旧版本。授权、启用与执行均核对安装清单和数据库版本/结构及待恢复笔记，不一致时拒绝；完成恢复后仍须显式重新授权。

`plugins disable` 拒绝后续插件调用；`plugins uninstall` 清除执行授权并保留禁用模块、记录和笔记，不删除私人数据或仓库外代码。重新安装与保留模块一致的清单可以接管这些数据，但仍需新授权；清单不同则不能直接覆盖。

执行配置位于数据目录的 `plugin-state.json`，以私人文件权限和原子改名保存，包含清单快照、代码哈希、授权及最近失败事件。它不包含在 `Store` 数据备份中。恢复到新目录时，带 `contract` 的模块自动禁用，不自动恢复代码信任或执行插件；须在仓库外准备与恢复模块一致的清单，重新 `install → authorize → enable`。迁移失败或需要回退时，先把迁移前备份恢复到新目录，再按此流程重装授权。

## 可信本地 stdio 与验证边界

默认路径使用声明式 handler。`stdio` 只支持经过审查的可信本地**单文件 `.mjs`**，入口须与清单位于同一仓库外目录。首次安装不会启动它；即使已授予读或建议权限，也不能执行。若要运行样例 `summarize`，必须另存授权文件并明确确认代码信任及未隔离网络这一限制：

```json
{
  "permissions": ["read-plants", "suggest-plants"],
  "trustLocalCode": true,
  "acknowledgeUnsandboxedNetwork": true
}
```

执行 `plugins authorize demo.plugin-plants /outside-repository/trusted-grants.json`，再 `plugins enable demo.plugin-plants` 和 `plugins invoke demo.plugin-plants summarize`。代码哈希改变后会拒绝执行，必须升级并重新审查授权；这些标志不是系统沙箱授权，也不会允许 broker 外部动作。

运行器使用 Node 24 子进程和 JSON 行协议：核心发送 `{protocol:1,type:"invoke",operation,input}`；插件可发送 `{protocol:1,type:"call",id,permission,action,input}`，其中 action 为 `list/save/patch-fields/external`；核心成功响应 `{protocol:1,type:"response",id,value}`，违规调用直接终止执行；插件最后发送 `{protocol:1,type:"result",value}` 并正常退出。broker 逐次校验操作权限及当前授权，写入暂存到成功退出后统一事务提交，提交前再次检查授权，失败退出不提交暂存写入。

子进程清空继承环境，校验固定代码哈希，并使用 `--permission` 仅允许读取暂存入口；不授予文件写入、子进程、worker 或 addon 权限，另有限时和输出上限。[Node 官方权限说明](https://nodejs.org/docs/latest-v24.x/api/permissions.html)明确此模式不能防恶意代码。它**不隔离直接网络或其他系统调用，不是恶意代码强沙箱**；`external` 拒绝只保证 broker 的拒绝路径，不能宣称已阻断可信脚本直接联网。未知或不可信代码不得依靠此机制运行；恶意代码隔离需要另外的 OS 级措施，本版未实现或验证跨平台 OS 隔离。

本实现的专项证据是 [`tests/plugins.test.ts`](../tests/plugins.test.ts) 的 **9 个测试已通过**：契约拒绝、默认授权、公开/私有同协议、依赖、字段投影与补丁、升级失败回滚、卸载保留数据、失败子进程零写入、授权撤销、代码变更，以及 Node 24 权限探针。探针仅运行自有合成插件，并通过本地 loopback 服务证明直接网络仍可用；未连接真实数据、Vault、云服务或真实私有仓库，未部署、购买或执行金融交易。这份专项证据不代表整个项目最终测试门槛、Mac 原生运行或全部设计验收已经完成。
