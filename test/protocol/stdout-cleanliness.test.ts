import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

void test("CLI starts when invoked through a symlink", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "youtrack-mcp-cli-symlink-"));
  const symlink = join(directory, "youtrack-mcp.ts");

  try {
    try {
      symlinkSync(resolve("src/cli.ts"), symlink, "file");
    } catch (error: unknown) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (process.platform === "win32" && (code === "EPERM" || code === "EACCES")) {
        context.skip("Creating file symlinks requires Windows Developer Mode");
        return;
      }
      throw error;
    }

    const child = spawn(process.execPath, ["--import", "tsx", symlink], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        YOUTRACK_URL: "https://tracker.example.test/",
        YOUTRACK_TOKEN: "symlink-startup-placeholder",
        YOUTRACK_LOG_LEVEL: "error",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "symlink-test", version: "1" } },
    })}\n`);

    const response = await new Promise<string>((resolveResponse, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("stdio response timeout when CLI is invoked through a symlink"));
      }, 5_000);
      child.stdout.once("data", (chunk: Buffer) => {
        clearTimeout(timeout);
        resolveResponse(String(chunk));
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`CLI exited before responding with code ${String(code)}`));
      });
    });

    child.kill();
    await new Promise<void>((resolveClose) => { child.once("close", () => resolveClose()); });
    const frame = JSON.parse(response.trim().split(/\r?\n/u)[0] ?? "") as { id?: number; result?: { serverInfo?: unknown } };
    assert.equal(frame.id, 1);
    assert.ok(frame.result?.serverInfo);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
