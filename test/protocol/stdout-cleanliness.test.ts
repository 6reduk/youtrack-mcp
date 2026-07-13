import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

void test("stdio stdout contains JSON-RPC frames only and stderr redacts the token", async () => {
  const token = "stdout-cleanliness-secret";
  const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      YOUTRACK_URL: "https://tracker.example.test/",
      YOUTRACK_TOKEN: token,
      YOUTRACK_LOG_LEVEL: "debug",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "raw-test", version: "1" } },
  })}\n`);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("stdio response timeout")), 5_000);
    child.stdout.once("data", () => { clearTimeout(timeout); resolve(); });
  });
  child.stdin.end();
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(() => { child.kill(); resolve(); }, 1_000);
  });
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  assert.ok(lines.length >= 1);
  for (const line of lines) assert.doesNotThrow(() => JSON.parse(line));
  assert.equal(stdout.includes(token), false);
  assert.equal(stderr.includes(token), false);
});
