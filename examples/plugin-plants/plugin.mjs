// A single-file fictional trusted plugin, copied outside the repository before use.
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Worker } from "node:worker_threads";
import { get } from "node:http";
const lines = createInterface({ input: process.stdin });
const iterator = lines[Symbol.asyncIterator]();
const invoke = JSON.parse((await iterator.next()).value);
const send = (value) =>
  process.stdout.write(JSON.stringify({ protocol: 1, ...value }) + "\n");
async function call(permission, action, input) {
  send({ type: "call", id: "one", permission, action, input });
  return JSON.parse((await iterator.next()).value).value;
}
let value;
if (invoke.operation === "summarize") {
  const rows = await call("read-plants", "list");
  value = {
    count: rows.length,
    waterMl: rows.reduce((total, row) => total + (row.fields.waterMl ?? 0), 0),
  };
} else if (invoke.operation === "propose") {
  value = await call("suggest-plants", "save", invoke.input);
} else if (invoke.operation === "broker-probe") {
  value = await call(
    invoke.input.permission,
    invoke.input.action,
    invoke.input.request,
  );
  if (invoke.input.delayMs)
    await new Promise((resolve) => setTimeout(resolve, invoke.input.delayMs));
  if (invoke.input.failAfterCall) process.exit(7);
} else if (invoke.operation === "runtime-probe") {
  const denied = (fn) => {
    try {
      fn();
      return false;
    } catch (error) {
      return error.code === "ERR_ACCESS_DENIED";
    }
  };
  if (invoke.input.hang)
    await new Promise(() => {
      setInterval(() => {}, 1000);
    });
  if (invoke.input.flood) process.stdout.write("x".repeat(20000));
  value = {
    filesystemReadDenied: denied(() => readFileSync(invoke.input.secretPath)),
    filesystemWriteDenied: denied(() =>
      writeFileSync("unexpected.txt", "fictional"),
    ),
    childProcessDenied: denied(() => spawnSync(process.execPath, ["-e", "0"])),
    workerDenied: denied(() => new Worker("0", { eval: true })),
    environmentCleared:
      process.env.LIFE_PLUGIN_TEST_SECRET === undefined &&
      process.env.NODE_OPTIONS === undefined,
  };
  if (invoke.input.loopbackUrl) {
    value.directNetworkAllowed = await new Promise((resolve, reject) => {
      get(invoke.input.loopbackUrl, (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode === 200));
      }).on("error", reject);
    });
  }
} else throw Error("Unknown fictional plugin operation");
send({ type: "result", value });
lines.close();
