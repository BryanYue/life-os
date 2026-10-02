# 模块与迁移

核心使用同一 `Module` 契约装载公开和私有声明式模块（见 `src/types.ts`）。`codeVisibility` 只说明源码归属选择，不表示记录被发布。所有记录默认本机保存。家属记录即使代码是公开通用实现，也不进入同步。

当前契约：`id`（可命名空间）、`version`、`coreApi: 1`、`schemaVersion`、`enabled`、`codeVisibility`、多个 `entityTypes`（字段）、`relations`（目标模块及数量上限）、`views`（form/list/timeline）。已有字段包括 text、number、select、decimal、date，生成 JSON Schema 校验；未知字段拒绝。关系以稳定实体 ID 保存，可跨领域。人类写入与 Agent 范围由核心能力接口检查。

## 增加植物养护

```bash
npm run cli -- register examples/plants.json
```

重新打开界面即可使用植物、养护记录和复盘，并关联费用、时间线、目标；不修改核心业务代码。另一种安装方式是在仓库外 `LIFE_OS_HOME/plugins/` 放置该 JSON，启动时装载未注册模块。私有模块使用同样格式并设置 `codeVisibility: "private"`，位于仓库外或独立私有仓库；不把其 URL、名称、配置复制到公开 CI。

本版启动时不会按清单变化自动修改已注册 Schema。停用接口 `POST /api/modules/:id/enabled` 只控制后续业务写入，不删除历史数据。模块清单变更必须用显式迁移。

## Schema 升级

假设从植物 v0.1.0/schema 1 的 `waterMl` 改为 v0.2.0/schema 2 的 `waterMillilitres`：准备新清单及 `{"waterMl":"waterMillilitres"}` 重命名映射文件，再执行：

```bash
npm run cli -- migrate /outside-repository/plants-v2.json /outside-repository/renames.json
```

每次只前进一个 Schema 版本。先生成数据目录中的 `migration-backup-*.json`；在同一 SQLite 事务中更新清单、校验和迁移所有记录、追加日志。任何记录失败整体回滚；笔记写入由恢复日志处理。失败/成功/备份恢复路径已有实际测试。需要回退时把迁移前备份恢复到新目录，而不是猜测逆转换。

当前迁移器支持字段重命名和校验性升级；复杂转换需实现受审查的专门适配器。完整操作声明、权限声明、导入器发现、模块依赖解析和任意代码插件生命周期尚未实现，仍在验收矩阵跟踪，不能把 v0.1 的小契约当成全部设计稿已交付。
