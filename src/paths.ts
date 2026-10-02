import { existsSync, realpathSync } from "node:fs";
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
    (!rel.startsWith(".." + "/") && rel !== ".." && !isAbsolute(rel))
  )
    throw Error("Private data and keys must be outside the repository");
  return path;
}
