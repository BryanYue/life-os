import { relative } from "node:path";
import type { Store } from "./store.js";
import { HUMAN, type Capability } from "./types.js";
import { hasLearningLoop } from "./learning-loop-contract.js";

export function obsidianVault(store: Store, cap: Capability = HUMAN) {
  if (cap.role !== "human" || !cap.read.includes("*") || cap.scope)
    throw Error("Permission denied: local Obsidian access");
  return {
    vaultPath: store.vault.root,
    vaultManagerUri: "obsidian://choose-vault",
    registration: "unknown" as const,
    mode: "manual-markdown" as const,
  };
}

/** Resolve only an existing Life OS identity; never accept caller file paths,
 * launch a shell, register a vault or write via the Obsidian URI protocol. */
export function obsidianNote(
  store: Store,
  id: string,
  cap: Capability = HUMAN,
) {
  obsidianVault(store, cap);
  const entity = store.get(id, cap);
  if (!entity || entity.deleted) throw Error("Obsidian note unavailable");
  const note = store.vault.read(entity.id);
  if (!note) throw Error("Linked note missing");
  // Store.get validates the module identity and Vault rejects duplicate IDs,
  // symlinks and paths outside its own root before a link is returned.
  return {
    entityId: entity.id,
    relativePath: relative(store.vault.root, note.path),
    openUri: "obsidian://open?path=" + encodeURIComponent(note.path),
    noteHash: note.hash,
    protectedTeacherOriginal:
      entity.module === "languages" &&
      entity.type === "teacher-summary" &&
      hasLearningLoop(store.module(entity.module, false)),
  };
}
