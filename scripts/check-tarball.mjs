import { execFileSync } from "node:child_process";
import { join } from "node:path";
const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8", shell: process.platform === "win32", env: { ...process.env, npm_config_cache: join(process.cwd(), ".npm-cache") } });
const report = JSON.parse(output)[0];
if (!report || !Array.isArray(report.files)) throw new Error("npm pack did not return a file manifest");
const allowed = /^(dist\/|docs\/|examples\/|README\.md$|SECURITY\.md$|CHANGELOG\.md$|LICENSE$|package\.json$)/u;
const forbidden = report.files.map((item) => item.path).filter((path) => !allowed.test(path));
if (forbidden.length > 0) throw new Error(`Unexpected tarball files: ${forbidden.join(", ")}`);
for (const required of ["dist/cli.js", "README.md", "LICENSE", "package.json"]) {
  if (!report.files.some((item) => item.path === required)) throw new Error(`Required tarball file missing: ${required}`);
}
process.stdout.write(`Tarball allowlist valid: ${String(report.files.length)} files, ${String(report.size)} bytes packed.\n`);
