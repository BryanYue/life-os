import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import {
  basename,
  dirname,
  join,
  resolve,
  relative,
  isAbsolute,
} from "node:path";
import { fileURLToPath } from "node:url";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
export const projectRoot = realpathSync(
  resolve(
    sourceDirectory,
    basename(dirname(sourceDirectory)) === "dist" ? "../.." : "..",
  ),
);

// Resolve existing ancestors too: a new child of a symlink can otherwise put
// private data inside the repository while its textual path looks external.
export function outsideRepository(path: string) {
  path = resolve(path);
  let ancestor = path;
  const tail: string[] = [];
  while (!existsSync(ancestor)) {
    tail.unshift(basename(ancestor));
    const parent = dirname(ancestor);
    if (parent === ancestor) throw Error("Unresolvable private path");
    ancestor = parent;
  }
  const physical = join(realpathSync(ancestor), ...tail);
  const rel = relative(projectRoot, physical);
  if (
    rel === "" ||
    (!rel.startsWith(".." + "/") && rel !== ".." && !isAbsolute(rel)) ||
    insideOtherSourceCheckout(physical)
  )
    throw Error("Private data and keys must be outside the repository");
  return path;
}

// Sibling worktrees or clones of this project only ignore their own root-level
// private names, so nested data there could be committed. A Git repository is
// treated as a Life OS checkout only when it also carries this project's
// package name and source entry; ordinary private Git notes stay allowed.
function insideOtherSourceCheckout(physical: string) {
  for (let dir = physical; ; dir = dirname(dir)) {
    if (
      existsSync(join(dir, ".git")) &&
      existsSync(join(dir, "src", "paths.ts")) &&
      packageName(join(dir, "package.json")) === "life-os"
    )
      return true;
    if (dirname(dir) === dir) return false;
  }
}
function packageName(path: string) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 1_000_000) return undefined;
    return (JSON.parse(readFileSync(path, "utf8")) as { name?: unknown }).name;
  } catch {
    return undefined;
  }
}
