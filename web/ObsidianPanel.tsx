import React, { useState } from "react";
import type { obsidianNote, obsidianVault } from "../src/obsidian.js";
import type { SpecialistProps } from "./SpecialistPanels.js";
type Request = SpecialistProps["request"];
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function ObsidianPanel({ request }: { request: Request }) {
  const [info, setInfo] = useState<ReturnType<typeof obsidianVault> | null>(
    null,
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  return (
    <section className="panel obsidian-panel">
      <h2>与 Obsidian 使用同一份笔记</h2>
      <p>
        在本机 Obsidian 中选择“打开文件夹作为仓库”，选择下方 Life OS 专用
        Vault。无需专用插件。
      </p>
      <button
        type="button"
        className="button"
        disabled={loading}
        onClick={() => {
          setLoading(true);
          setError("");
          void request<ReturnType<typeof obsidianVault>>("/api/obsidian/vault")
            .then(setInfo)
            .catch((e) => setError(errorText(e)))
            .finally(() => setLoading(false));
        }}
      >
        查看本机 Vault 路径
      </button>
      {error && <p role="alert">{error}</p>}
      {info && (
        <div className="obsidian-details">
          <p>
            <code>{info.vaultPath}</code>
          </p>
          <a className="text-button" href={info.vaultManagerUri}>
            打开 Obsidian 仓库管理器
          </a>
          <p>
            此路径属于当前 Life OS
            服务所在机器。请在同一台机器注册文件夹；应用未检查 Obsidian
            是否安装或已注册。
          </p>
        </div>
      )}
      <p>
        先保存 Life OS 编辑，再到 Obsidian 修改正文。回到 Life OS
        点击刷新后重新打开记录，可读取外部修改；移动笔记时保留 life_id 和
        life_module。
      </p>
      <p>
        不会自动合并旧
        Vault，也没有后台监听或云同步。笔记冲突会保留外部内容并要求重新载入。请勿把
        Obsidian 自带同步用于运行中的 SQLite 数据库。
      </p>
    </section>
  );
}

export function ObsidianNoteLink({
  id,
  request,
}: {
  id: string;
  request: Request;
}) {
  const [note, setNote] = useState<ReturnType<typeof obsidianNote> | null>(
    null,
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  return (
    <div className="obsidian-note">
      <button
        type="button"
        className="text-button"
        disabled={loading}
        onClick={() => {
          setLoading(true);
          setError("");
          setNote(null);
          void request<ReturnType<typeof obsidianNote>>(
            "/api/obsidian/notes/" + encodeURIComponent(id),
          )
            .then(setNote)
            .catch((e) => setError(errorText(e)))
            .finally(() => setLoading(false));
        }}
      >
        准备 Obsidian 打开链接
      </button>
      {note && (
        <p>
          <a href={note.openUri}>在 Obsidian 打开笔记</a> ·{" "}
          <code>{note.relativePath}</code>
        </p>
      )}
      {note && (
        <p className="form-help">
          需要先在同机 Obsidian 注册此
          Vault。此操作只打开已保存笔记；不会保存当前表单。移动后请重新准备链接。
        </p>
      )}
      {note?.protectedTeacherOriginal && (
        <p className="form-help">
          此笔记正文是受保护的教师来源原文，请只读查看。修改摘要请回到学习闭环；
          更新原文请使用教师导入入口提交新来源修订。外部改写正文会阻止刷新、同步导出和备份，
          须先保留外部副本，再恢复原文。
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
