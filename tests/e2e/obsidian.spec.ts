import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Entity } from "../../src/types.js";
async function navigate(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "展开导航", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page
    .locator(".sidebar")
    .getByRole("button", { name, exact: true })
    .click();
}
for (const width of [1440, 390]) {
  test(`Obsidian ${width}px：显式路径指引、移动后打开链接及外部编辑冲突往返`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(
      page.getByText("本地服务已连接", { exact: true }),
    ).toBeVisible();
    const session = await (await page.request.get("/api/session")).json();
    const response = await page.request.post("/api/entities", {
      headers: { "x-csrf-token": session.csrf },
      data: {
        expectedVersion: 0,
        entity: {
          module: "learning",
          type: "note",
          kind: "fact",
          status: "done",
          title: `虚构 Obsidian 往返 ${width}`,
          occurredAt: "2030-04-01",
          timeZone: "UTC",
          fields: { topic: "Synthetic interoperability" },
          relations: [],
          body: "合成原文",
        },
      },
    });
    expect(response.ok()).toBeTruthy();
    const entity = (await response.json()) as Entity;
    await page.reload();
    await expect(
      page.getByText("本地服务已连接", { exact: true }),
    ).toBeVisible();
    await navigate(page, "数据与设置");
    const panel = page.locator(".obsidian-panel");
    await panel.getByRole("button", { name: "查看本机 Vault 路径" }).click();
    const info = await (await page.request.get("/api/obsidian/vault")).json();
    // This service's e2e-server creates a disposable /tmp fixture; never use a real Vault.
    expect(info.vaultPath).toMatch(/\/life-e2e-[^/]+\/vault$/);
    await expect(panel.locator("code")).toHaveText(info.vaultPath);
    await expect(
      panel.getByRole("link", { name: "打开 Obsidian 仓库管理器" }),
    ).toHaveAttribute("href", "obsidian://choose-vault");
    await navigate(page, "阅读学习");
    await page
      .locator(".record-main")
      .filter({ hasText: entity.title })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("button", { name: "准备 Obsidian 打开链接" })
      .click();
    const link = dialog.getByRole("link", { name: "在 Obsidian 打开笔记" });
    await expect(link).toBeVisible();
    const uri = await link.getAttribute("href");
    const oldPath = new URL(uri!).searchParams.get("path")!;
    expect(oldPath.startsWith(info.vaultPath + "/")).toBeTruthy();
    const movedDir = join(info.vaultPath, `synthetic-moved-${width}`);
    mkdirSync(movedDir);
    const newPath = join(movedDir, "合成 & note.md");
    renameSync(oldPath, newPath);
    writeFileSync(
      newPath,
      readFileSync(newPath, "utf8")
        .replace("---\n", "---\nsynthetic_custom: keep\n")
        .replace("合成原文", "Obsidian 合成外部修改"),
    );
    await dialog
      .getByRole("button", { name: "准备 Obsidian 打开链接" })
      .click();
    await expect(link).toHaveAttribute(
      "href",
      "obsidian://open?path=" + encodeURIComponent(newPath),
    );
    await dialog
      .getByLabel("笔记", { exact: true })
      .fill("旧表单不可覆盖外部正文");
    await dialog.getByRole("button", { name: "保存记录", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("changed externally");
    expect(readFileSync(newPath, "utf8")).toContain("Obsidian 合成外部修改");
    await dialog.getByRole("button", { name: "关闭编辑" }).click();
    await page.reload();
    await expect(
      page.getByText("本地服务已连接", { exact: true }),
    ).toBeVisible();
    await navigate(page, "阅读学习");
    await page
      .locator(".record-main")
      .filter({ hasText: entity.title })
      .click();
    await expect(dialog.getByLabel("笔记", { exact: true })).toHaveValue(
      "Obsidian 合成外部修改",
    );
    await dialog
      .getByLabel("笔记", { exact: true })
      .fill("人工核对后的合成正文");
    await dialog.getByRole("button", { name: "保存记录", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(readFileSync(newPath, "utf8")).toContain("synthetic_custom: keep");
    expect(readFileSync(newPath, "utf8")).toContain("人工核对后的合成正文");
    await page
      .locator(".record-main")
      .filter({ hasText: entity.title })
      .click();
    await dialog
      .getByRole("button", { name: "准备 Obsidian 打开链接" })
      .click();
    await expect(link).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `/tmp/life-os-evidence/obsidian-${width}.png`,
      fullPage: true,
    });
  });
}
