import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
const dir = mkdtempSync(join(tmpdir(), "life-e2e-"));
const child = spawn(process.execPath, ["dist/src/server.js"], {
  stdio: "inherit",
  env: { ...process.env, LIFE_OS_HOME: dir },
});
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));
child.on("exit", (code) => {
  rmSync(dir, { recursive: true, force: true });
  process.exit(code ?? 0);
});
