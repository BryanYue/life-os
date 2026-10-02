import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { Store } from "./store.js";
import { importHealth } from "./importers.js";
import { outsideRepository } from "./paths.js";
import {
  createKeyFile,
  readKeyFile,
  seal,
  unseal,
  type Purpose,
} from "./sealed.js";
import type { SyncPacket } from "./types.js";
import { PluginManager } from "./plugins.js";
import { projectRoot } from "./paths.js";
import {
  exportBootstrap,
  importBootstrap,
  exportProjection,
  importProjection,
  listProjections,
} from "./sync.js";
import { normalizedScope } from "./permissions.js";
import type { SyncBootstrap, SyncProjection } from "./types.js";
import { importResearchResult } from "./research.js";
import { importAppleHealthXml } from "./apple-health.js";
import { seedDemo } from "./domain.js";
import { pendingBuiltinUpgrades, upgradeBuiltin } from "./builtin-upgrades.js";
const [command, ...args] = process.argv.slice(2);
const root = resolve(process.env.LIFE_OS_HOME ?? join(homedir(), ".life-os"));
const key = () => {
  const path = process.env.LIFE_OS_KEY_FILE;
  if (!path)
    throw Error(
      "Set LIFE_OS_KEY_FILE to a private key file outside the repository",
    );
  return readKeyFile(path);
};
const readInput = <T>(path: string, purpose: Purpose): T => {
  const data = JSON.parse(readFileSync(path, "utf8"));
  return command.endsWith("-encrypted")
    ? unseal<T>(data, purpose, key())
    : data;
};
const output = (path: string, value: unknown, purpose: Purpose) => {
  writeFileSync(
    outsideRepository(path),
    JSON.stringify(
      command.endsWith("-encrypted") ? seal(value, purpose, key()) : value,
    ),
    { flag: "wx", mode: 0o600 },
  );
};
if (command === "keygen") {
  if (!args[0])
    throw Error(
      "keygen NEW_KEY_FILE (keep a separate secure copy; lost keys cannot be recovered)",
    );
  createKeyFile(args[0]);
  console.log(
    "Private local key file created; keep it separate from exported files.",
  );
} else if (command === "restore" || command === "restore-encrypted") {
  if (!args[0] || !args[1]) throw Error("restore BACKUP NEW_DIRECTORY");
  const restored = Store.restore(
    outsideRepository(args[1]),
    readInput(args[0], "backup"),
  );
  restored.close();
  console.log(
    "Restored into isolated new directory. Automatic cloud sync is not configured.",
  );
} else {
  outsideRepository(root);
  const s = new Store(root, { skipNoteRecovery: command === "recover-note" });
  const syncGrant = () => {
    const config = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
    return config.syncScope ?? config.syncModules ?? [];
  };
  try {
    switch (command) {
      case "builtin-upgrades":
        console.log(pendingBuiltinUpgrades(s));
        break;
      case "upgrade-builtin":
        if (!args[0]) throw Error("upgrade-builtin learning|languages");
        console.log(upgradeBuiltin(s, args[0]));
        break;
      case "plugins": {
        const manager = new PluginManager(s, { repositoryRoot: projectRoot });
        const [action, idOrPath, ...rest] = args;
        switch (action) {
          case "list":
            console.log(manager.list());
            break;
          case "install":
            console.log(manager.install(idOrPath));
            break;
          case "upgrade":
            console.log(manager.upgrade(idOrPath));
            break;
          case "authorize":
            console.log(
              manager.authorize(
                idOrPath,
                rest[0] ? JSON.parse(readFileSync(rest[0], "utf8")) : {},
              ),
            );
            break;
          case "enable":
          case "disable":
          case "uninstall":
            console.log(manager[action](idOrPath));
            break;
          case "invoke":
            console.log(
              await manager.invoke(
                idOrPath,
                rest[0],
                rest[1] ? JSON.parse(readFileSync(rest[1], "utf8")) : {},
              ),
            );
            break;
          case "import":
            console.log(
              await manager.import(
                idOrPath,
                rest[0],
                readFileSync(rest[1], "utf8"),
              ),
            );
            break;
          default:
            throw Error(
              "plugins list|install PATH|upgrade PATH|authorize ID [JSON_FILE]|enable ID|disable ID|uninstall ID|invoke ID OP [JSON_FILE]|import ID IMPORTER FILE",
            );
        }
        break;
      }
      case "import-research":
        console.log(
          importResearchResult(s, JSON.parse(readFileSync(args[0], "utf8"))).id,
        );
        break;
      case "import-apple-health": {
        if (!args[0] || !args[1])
          throw Error(
            "import-apple-health XML_FILE IANA_TIMEZONE [LOCAL_SOURCE_ID]",
          );
        const report = importAppleHealthXml(s, readFileSync(args[0], "utf8"), {
          timeZone: args[1],
          sourceId: args[2],
        });
        console.log({
          imported: report.imported.length,
          skipped: report.skipped,
          errors: report.errors,
        });
        break;
      }
      case "export-bootstrap":
      case "export-bootstrap-encrypted":
        output(args[0], exportBootstrap(s, syncGrant()), "sync");
        break;
      case "import-bootstrap":
      case "import-bootstrap-encrypted":
        console.log(
          importBootstrap(
            s,
            readInput<SyncBootstrap>(args[0], "sync"),
            syncGrant(),
            { acceptManifests: args[1] === "--accept-manifests" },
          ),
        );
        break;
      case "export-projection":
      case "export-projection-encrypted":
        output(
          args[0],
          exportProjection(s, normalizedScope(syncGrant())),
          "sync",
        );
        break;
      case "import-projection":
      case "import-projection-encrypted":
        console.log(
          importProjection(
            s,
            readInput<SyncProjection>(args[0], "sync"),
            normalizedScope(syncGrant()),
          ),
        );
        break;
      case "projections":
        console.log(listProjections(s));
        break;
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
      case "backup-encrypted":
        if (!args[0]) throw Error("backup OUTPUT_FILE");
        output(args[0], s.backup(), "backup");
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
      case "export-sync":
      case "export-sync-encrypted": {
        const config = JSON.parse(
          readFileSync(join(root, "config.json"), "utf8"),
        );
        output(
          args[0],
          s.exportPacket(
            Number(args[1] ?? 0),
            config.syncScope ?? config.syncModules ?? [],
          ),
          "sync",
        );
        console.log("Local simulation packet exported");
        break;
      }
      case "import-sync":
      case "import-sync-encrypted": {
        const config = JSON.parse(
          readFileSync(join(root, "config.json"), "utf8"),
        );
        console.log(
          s.importPacket(
            readInput<SyncPacket>(args[0], "sync"),
            config.syncScope ?? config.syncModules ?? [],
          ),
        );
        break;
      }
      default:
        console.log(
          "Commands: demo, backup FILE, restore FILE NEW_DIRECTORY, register MANIFEST, migrate MANIFEST [RENAMES_JSON], builtin-upgrades, upgrade-builtin learning|languages, import ENTITY_JSON, export-sync FILE [CURSOR], import-sync FILE, export-bootstrap FILE, import-bootstrap FILE [--accept-manifests], export-projection FILE, import-projection FILE, projections, plugins ACTION, import-research FILE, import-apple-health XML TIMEZONE; keygen FILE; backup-encrypted / restore-encrypted / export-sync-encrypted / import-sync-encrypted use LIFE_OS_KEY_FILE",
        );
    }
  } finally {
    s.close();
  }
}
