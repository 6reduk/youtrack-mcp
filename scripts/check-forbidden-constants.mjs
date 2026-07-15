import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const roots = ["src", "dist"];
const forbidden = [/youtrack\.fin-it\.tech/iu, /DEV-2517/u, /project-dev/iu, /\bFinit\b/iu, /\bDEV\b/u, /\bIn Progress\b/iu, /\bDone\b/iu];
const files = [];
function walk(path) { for (const name of readdirSync(path)) { const item = join(path, name); if (statSync(item).isDirectory()) walk(item); else files.push(item); } }
for (const root of roots) walk(root);
const hits = files.flatMap((file) => forbidden.flatMap((pattern) => pattern.test(readFileSync(file, "utf8")) ? [`${file}: ${String(pattern)}`] : []));
if (hits.length > 0) { process.stderr.write(`${hits.join("\n")}\n`); process.exitCode = 1; }
else process.stdout.write("No installation-specific runtime constants found.\n");
