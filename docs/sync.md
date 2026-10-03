# 本地多副本同步模拟

这里验证本地协议，**不是自动云同步**。未批准供应商、账号、真实传输范围或设备授权；核心不会上传数据，也不通过网盘覆盖运行中的 SQLite。两到三个独立本机数据目录模拟离线、重连和恢复。

## 源码续接与个人数据分别处理

Git 提交、分支和 bundle 只传递公共源码及虚构示例；不包含运行中的 SQLite、Vault、个人配置、私人模板或插件授权。把 Mac 新提交带回云端开发环境，仅代表继续开发同一源码历史，不会自动上传或恢复产品数据。

2026-10-03 Mac 迁移基线 bundle 停在 `5f1ff29`，本地随后有 `25a566f` 的 UTC 日期修复及后续开发。云端若仍停在 `5f1ff29`，续接必须取得最新 Mac 提交及其祖先对象，核对目标工作树无人写入、无未保存改动，再按祖先关系快进或明确合并；不能覆盖云端新增提交、直接复制工作目录代替核对历史，或把旧 bundle 当作最新源码。具体最新 SHA 以 Git 和本轮验证证据为准。本机 origin 当前为导入 bundle 的本地路径，不是 GitHub 发布目的地。

本机目录分工：`$WORKSPACE/life-os` 为源码与编译产物；`life-os-local-ops` 保存专用 Node24、启停脚本和本机证据；`life-os-demo-20261003` 是原演示运行数据；`life-os-restored-20261003` 是隔离恢复验收副本，二者不是 Git checkout。当前旧启动器组合原源码目录的编译入口、ops 中的 Node/TMPDIR 与演示数据根，不能把这四者当成四份代码仓库互相覆盖。

远程写入仍暂停。以后推送前须重新验证当前执行环境绑定的已授权个人连接与目标仓库身份、指定 noreply 元数据及受限历史更新条件；连接器拥有权限不代表终端身份已切换。真实产品数据传输须另定接收方、范围、加密和恢复条件；下文的本地模拟协议不构成该授权。当前没有真实云连接器。

## 授权范围与操作入口

默认导出空范围。在各自仓库外数据目录的 `config.json` 明确填写本地演练范围；需要重启服务：

```json
{ "syncModules": ["planning", "learning"] }
```

`syncScope` 存在时优先于 `syncModules`，可选择实体 ID 或类型。提供 `entities` 时，未列出的模块不获实体权限：

```json
{
  "syncScope": {
    "modules": ["planning"],
    "entities": { "planning": { "entityTypes": ["goal"] } }
  }
}
```

`family` 无论配置如何都排除。完整可编辑记录同步必须包含其全部字段、正文、元数据与获准关系目标；范围不完整时整包拒绝。关系目标不能通过隐式复制扩大授权。新增授权范围可用当前版本基线补齐，不能认为已经走过的全局游标会自动回填新范围。

设置页和 CLI 均可手动交换文件。普通文件和浏览器导出是明文；CLI 输出路径必须在仓库外且不得覆盖现有文件。

```bash
LIFE_OS_HOME=/tmp/life-a npm run cli -- export-sync /tmp/a-batch.json 0
LIFE_OS_HOME=/tmp/life-b npm run cli -- import-sync /tmp/a-batch.json
```

导入返回 `cursor`，下次导出使用它。每包最多 500 条日志跨度；白名单过滤后即使为空，也推进相应源设备游标。初始相同 Schema 可从 0 重放；跨版本历史使用下述基线。没有后台轮询、网络自动重连或对端发现。

## 跨 Schema 初始化

协议 2 `bootstrap` 包含当前模块清单、当前完整记录、源游标、历史操作摘要和来源修订收据。它初始化当前授权中尚不存在的记录，不需按已移除的旧字段 Schema 重放历史：

```bash
LIFE_OS_HOME=/tmp/life-a npm run cli -- export-bootstrap /tmp/a-baseline.json
LIFE_OS_HOME=/tmp/life-b npm run cli -- import-bootstrap /tmp/a-baseline.json --accept-manifests
```

新模块或改变的 Schema 需要显式接受清单；设置页有相同选择。这里只安装声明，含可执行插件契约的模块默认停用。接收端已有该模块数据时，不能借基线替换其 Schema；先用本地显式迁移升级，不能覆盖已有实体。相同 ID 的孤立 Markdown 也在提交前拒绝。

清单、记录、来源收据、历史摘要和游标在同一数据库事务提交。正文通过既有可恢复日志写入。任何 Schema/权限/关联错误整体回滚。重复基线和旧操作重放不增加实体；继承收据会继续进入下一次基线，因此 A→B→C 后重放 A 的旧记录不会产生伪冲突。测试覆盖 schema 1→2、新副本初始化、继续离线双方编辑合并、来源 r2 延续同一实体和备份恢复。

这不是任意迁移程序分发。已含数据的两个副本仍须各自执行经过审查的本地 Schema 迁移；不能自动猜测字段转换。

## 字段选择只读分享

字段级分享使用 `projection`，**不作为可编辑主记录合并**。例如只分享规划目标的 `measure`，可选明确允许的标题/时间：

```json
{
  "syncScope": {
    "modules": ["planning"],
    "entities": {
      "planning": {
        "entityTypes": ["goal"],
        "fields": ["measure"],
        "metadata": ["title", "occurredAt", "timeZone"],
        "body": false,
        "relations": false
      }
    }
  }
}
```

一旦选择 fields/metadata 或排除正文/关系，未显式允许的正文、关系、标题、来源、修改者和时间会隐藏，笔记 hash 不导出；结构身份、kind/status、版本及 tombstone 仍保留。`metadata` 支持 `title/source/actor/createdAt/updatedAt/occurredAt/timeZone`。整记录同步接口拒绝投影权限，不能绕过字段限制带出私密内容。

```bash
LIFE_OS_HOME=/tmp/life-a npm run cli -- export-projection /tmp/a-view.json
LIFE_OS_HOME=/tmp/life-b npm run cli -- import-projection /tmp/a-view.json
LIFE_OS_HOME=/tmp/life-b npm run cli -- projections
```

接收端再次按自身范围验证每个字段和关系，独立保存只读副本，不创建或清空可编辑实体/Vault。相同源与范围按游标更新；旧包忽略、同游标不同内容拒绝。设置页能查看只读数据。修改源记录后重新导出可更新或传递删除标记。未知扩展属性、异常结构和越权内容拒绝。撤销未来读取权限不会追溯擦除已经复制给对端的文件。

## 增量、冲突与恢复

协议 1 操作包保存设备/批次、起止游标、完成标志、操作 ID、源序列、基础与新快照和 SHA-256。SHA-256 只检测损坏，**不是认证签名**。未知版本、未完成包、游标缺口、权限或 Schema 错误拒绝；实体、冲突与游标事务提交。来源导入收据随操作重建，同修订改内容拒绝；新修订沿用稳定实体。

结构化字段三方合并；不同字段自动合并，相同字段竞争保留双方。Markdown 使用 node-diff3；重叠修改进入冲突队列。设置页审阅并选择版本，选择本身形成新操作，使之后双方交换收敛。删除使用 tombstone；离线编辑与删除冲突不会静默复活记录。模块、类型和计划/事实/推断身份不可借同步改写。同步历史与冲突保存私人正文，应与数据库同等保护。

备份包含完整逻辑表、受管理 Markdown、模块/迁移版本、操作与游标、来源收据、基线收据及只读投影。恢复在临时目录验证全部表、路径、索引、关联和协议状态，再发布新目录；损坏或缺表时不留下部分恢复。恢复生成新设备 ID 并标为隔离，不自动上传；插件代码和信任授权不在备份中，可执行插件停用，需重新安装/授权。未知笔记、二进制附件、周期备份和保留策略不在当前备份范围。

## 可选认证加密文件

按 README 创建仓库外 `LIFE_OS_KEY_FILE` 后，以上 `export-sync/import-sync`、`export-bootstrap/import-bootstrap`、`export-projection/import-projection` 都可加 `-encrypted` 后缀。双方本地演练需持同一密钥；程序不分发密钥，不授予云同步权限。

AES-256-GCM 使用随机 96 位 nonce、256 位密钥、128 位 tag，版本与用途作为附加认证数据。错钥、篡改、用途或版本错误在导入前拒绝；内部权限、游标、去重与冲突规则仍执行。共享文件密钥不等于设备身份、撤销、轮换或 Keychain；SQLite/Vault 本身仍明文。
