import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const script = join(repositoryRoot, "scripts/bump-version.mjs");
const fixtureFiles = [
  "package.json",
  "package-lock.json",
  "CHANGELOG.md",
  "README.md",
  "examples/claude.example.json",
  "examples/codex.example.toml",
  "examples/kimi.example.json",
  "src/server/create-server.ts",
];

function fixture(withUnreleased = true): string {
  const root = mkdtempSync(join(tmpdir(), "youtrack-version-bump-"));
  for (const relativePath of fixtureFiles) {
    const destination = join(root, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(repositoryRoot, relativePath), destination);
  }
  if (withUnreleased) {
    const changelogPath = join(root, "CHANGELOG.md");
    const changelog = readFileSync(changelogPath, "utf8");
    writeFileSync(changelogPath, changelog.replace("# Changelog\n", "# Changelog\n\n## Unreleased\n\n- Test release note.\n"));
  }
  return root;
}

void test("version bump updates every release reference on every platform", () => {
  const root = fixture();
  const current = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;
  const [major, minor, patch] = current.split(".").map(Number) as [number, number, number];
  const target = `${String(major)}.${String(minor)}.${String(patch + 1)}`;
  execFileSync(process.execPath, [script, "patch", "--date", "2026-07-16", "--root", root]);
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
  const packageLock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as { version: string; packages: Record<string, { version: string }> };
  assert.equal(packageJson.version, target);
  assert.equal(packageLock.version, target);
  assert.equal(packageLock.packages[""]?.version, target);
  assert.match(readFileSync(join(root, "CHANGELOG.md"), "utf8"), new RegExp(`^## ${target.replaceAll(".", "\\.")} - 2026-07-16$`, "mu"));
  for (const relativePath of fixtureFiles.slice(3, 7)) {
    assert.ok(readFileSync(join(root, relativePath), "utf8").includes(`@6reduk/youtrack-mcp@${target}`));
  }
  assert.ok(readFileSync(join(root, "src/server/create-server.ts"), "utf8").includes(`version: "${target}"`));
  execFileSync(process.execPath, [script, "--check", "--root", root]);
});

void test("version bump fails without release notes and does not modify files", () => {
  const root = fixture(false);
  const before = readFileSync(join(root, "package.json"), "utf8");
  const result = spawnSync(process.execPath, [script, "patch", "--root", root], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must contain a top-level '## Unreleased'/u);
  assert.equal(readFileSync(join(root, "package.json"), "utf8"), before);
});
