import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const roots = ["src", "dist", "test", "scripts"];
const secretPatterns = [/perm:[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9_-]{12,}/gu, /Bearer\s+[A-Za-z0-9._-]{20,}/gu];
const hits = [];
function walk(path) { for (const name of readdirSync(path)) { const item = join(path, name); if (statSync(item).isDirectory()) walk(item); else { const text = readFileSync(item, "utf8"); if (secretPatterns.some((pattern) => { pattern.lastIndex = 0; return pattern.test(text); })) hits.push(item); } } }
for (const root of roots) walk(root);
if (hits.length > 0) { process.stderr.write(`Potential secrets: ${hits.join(", ")}\n`); process.exitCode = 1; }
else process.stdout.write("No credential-shaped values found.\n");
