import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
const tarballArg = process.argv[2];
if (!tarballArg) throw new Error("Usage: npm run smoke:packed -- <tarball.tgz>");
const tarball = resolve(tarballArg), dir = mkdtempSync(join(tmpdir(), "youtrack-mcp-packed-"));
try {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ private: true }));
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], { cwd: dir, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, npm_config_cache: join(dir, ".npm-cache") } });
  const manifest = JSON.parse(readFileSync(join(dir, "node_modules", "@6reduk", "youtrack-mcp", "package.json"), "utf8"));
  if (manifest.name !== "@6reduk/youtrack-mcp") throw new Error(`Unexpected installed package from ${basename(tarball)}`);
  const bin = join(dir, "node_modules", ".bin", process.platform === "win32" ? "youtrack-mcp.cmd" : "youtrack-mcp");
  const child = spawn(bin, [], { cwd: dir, env: { ...process.env, YOUTRACK_URL: "https://tracker.example.test/", YOUTRACK_TOKEN: "packed-smoke-placeholder", YOUTRACK_LOG_LEVEL: "error" }, stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32" });
  const request = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "packed-smoke", version: "1" } } };
  child.stdin.write(`${JSON.stringify(request)}\n`);
  const result = await new Promise((resolveResult, reject) => { const timer = setTimeout(() => reject(new Error("Packed stdio handshake timed out")), 10_000); child.stdout.once("data", (chunk) => { clearTimeout(timer); resolveResult(String(chunk)); }); child.once("error", reject); });
  child.kill();
  await new Promise((resolveClose) => child.once("close", resolveClose));
  const response = JSON.parse(String(result).trim().split(/\r?\n/u)[0]);
  if (response.id !== 1 || !response.result?.serverInfo) throw new Error("Packed stdio handshake returned an invalid response");
  process.stdout.write(`Packed stdio handshake passed for ${manifest.name}@${manifest.version}.\n`);
} finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
