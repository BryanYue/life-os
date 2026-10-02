import {
  existsSync,
  mkdirSync,
  readdirSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  renameSync,
  realpathSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { join, dirname, relative, isAbsolute } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { parseDocument, isMap } from "yaml";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function splitNote(markdown: string) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown);
  if (markdown.startsWith("---\n") && !m)
    throw Error("Malformed Markdown frontmatter");
  const doc = parseDocument(m?.[1] ?? "", { strict: true });
  if (doc.errors.length) throw Error("Invalid frontmatter");
  if (doc.contents && !isMap(doc.contents))
    throw Error("Frontmatter must be a mapping");
  return { doc, body: m ? m[2] : markdown };
}
export class Vault {
  constructor(public root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    if (lstatSync(root).isSymbolicLink()) throw Error("Vault symlink denied");
    this.root = realpathSync(root);
  }
  check(path: string) {
    const rel = relative(this.root, path);
    if (rel.startsWith("..") || isAbsolute(rel))
      throw Error("Vault path denied");
    let p = this.root;
    for (const bit of rel.split("/")) {
      p = join(p, bit);
      if (existsSync(p) && lstatSync(p).isSymbolicLink())
        throw Error("Vault symlink denied");
    }
    return path;
  }
  files(dir = this.root): string[] {
    this.check(dir);
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = this.check(join(dir, e.name));
      return e.isDirectory()
        ? this.files(p)
        : e.isFile() && e.name.endsWith(".md")
          ? [p]
          : [];
    });
  }
  locate(id: string) {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw Error("Invalid entity ID");
    const matches = this.files().filter(
      (p) =>
        String(splitNote(readFileSync(p, "utf8")).doc.get("life_id")) === id,
    );
    if (matches.length > 1) throw Error("Duplicate note identity");
    return matches[0];
  }
  read(id: string) {
    const path = this.locate(id);
    if (!path) return null;
    const markdown = readFileSync(path, "utf8");
    return {
      path,
      markdown,
      body: splitNote(markdown).body,
      hash: hash(markdown),
    };
  }
  compose(id: string, module: string, body: string, previous = "") {
    const { doc } = splitNote(previous);
    doc.set("life_id", id);
    doc.set("life_module", module);
    return "---\n" + doc.toString() + "---\n" + body;
  }
  write(id: string, markdown: string) {
    const path = this.locate(id) ?? this.check(join(this.root, id + ".md"));
    const temp = this.check(join(dirname(path), "." + randomUUID() + ".tmp"));
    const fd = openSync(temp, "wx", 0o600);
    try {
      writeFileSync(fd, markdown);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
  }
}
