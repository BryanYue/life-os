import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { Store } from "./store.js";
import { importHealth } from "./importers.js";
import { seedDemo } from "./domain.js";
const [command, ...args] = process.argv.slice(2);
const root = resolve(process.env.LIFE_OS_HOME ?? join(homedir(), ".life-os"));
if (command === "restore") {
  if (!args[0] || !args[1]) throw Error("restore BACKUP NEW_DIRECTORY");
  const restored = Store.restore(
    resolve(args[1]),
    JSON.parse(readFileSync(args[0], "utf8")),
  );
  restored.close();
  console.log(
    "Restored into isolated new directory. Automatic cloud sync is not configured.",
  );
} else {
  if (root === process.cwd() || root.startsWith(process.cwd() + "/"))
    throw Error("Data must be outside the repository");
  const s = new Store(root, { skipNoteRecovery: command === "recover-note" });
  try {
    switch (command) {
      case "recover-note":
        if (!["external", "pending"].includes(args[1]))
          throw Error("recover-note ID external|pending");
        s.recoverNote(args[0], args[1] as "external" | "pending");
        console.log("Pending note resolved");
        break;
      case "demo":
        console.log(seedDemo(s));
        break;
      case "backup":
        if (!args[0]) throw Error("backup OUTPUT_FILE");
        writeFileSync(args[0], JSON.stringify(s.backup()), {
          mode: 0o600,
          flag: "wx",
        });
        console.log("Backup written");
        break;
      case "register":
        s.register(JSON.parse(readFileSync(args[0], "utf8")));
        console.log("Module registered");
        break;
      case "migrate":
        console.log(
          s.migrateModule(
            JSON.parse(readFileSync(args[0], "utf8")),
            args[1] ? JSON.parse(readFileSync(args[1], "utf8")) : {},
          ),
        );
        break;
      case "import-health":
        console.log({
          imported: importHealth(s, JSON.parse(readFileSync(args[0], "utf8")))
            .length,
        });
        break;
      case "import":
        console.log(
          s.importSource(JSON.parse(readFileSync(args[0], "utf8"))).id,
        );
        break;
      case "export-sync": {
        const config = JSON.parse(
          readFileSync(join(root, "config.json"), "utf8"),
        );
        writeFileSync(
          args[0],
          JSON.stringify(
            s.exportPacket(Number(args[1] ?? 0), config.syncModules ?? []),
          ),
          { mode: 0o600, flag: "wx" },
        );
        console.log("Local simulation packet exported");
        break;
      }
      case "import-sync": {
        const config = JSON.parse(
          readFileSync(join(root, "config.json"), "utf8"),
        );
        console.log(
          s.importPacket(
            JSON.parse(readFileSync(args[0], "utf8")),
            config.syncModules ?? [],
          ),
        );
        break;
      }
      default:
        console.log(
          "Commands: demo, backup FILE, restore FILE NEW_DIRECTORY, register MANIFEST, migrate MANIFEST [RENAMES_JSON], import ENTITY_JSON, export-sync FILE [CURSOR], import-sync FILE",
        );
    }
  } finally {
    s.close();
  }
}
