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

function fixture(withUnreleased = true, sourceWithoutUnreleased = false): string {
  const root = mkdtempSync(join(tmpdir(), "youtrack-version-bump-"));
  for (const relativePath of fixtureFiles) {
    const destination = join(root, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(repositoryRoot, relativePath), destination);
  }
  const changelogPath = join(root, "CHANGELOG.md");
  const marker = "## Unreleased";
  let changelog = readFileSync(changelogPath, "utf8");
  if (sourceWithoutUnreleased) {
    const sourceStart = changelog.indexOf(marker);
    const sourceNext = sourceStart < 0 ? -1 : changelog.indexOf("\n## ", sourceStart + marker.length);
    if (sourceStart >= 0) {
      changelog = `${changelog.slice(0, sourceStart)}${sourceNext < 0 ? "" : changelog.slice(sourceNext + 1)}`;
    }
  }
  const sectionStart = changelog.indexOf(marker);
  const nextSection = sectionStart < 0 ? -1 : changelog.indexOf("\n## ", sectionStart + marker.length);
  const headerEnd = changelog.indexOf("\n", changelog.indexOf("# Changelog"));
  if (headerEnd < 0) throw new Error("Fixture changelog header is missing");
  const before = sectionStart < 0 ? `${changelog.slice(0, headerEnd + 1)}\n` : changelog.slice(0, sectionStart);
  const after = sectionStart < 0
    ? changelog.slice(headerEnd + 1).trimStart()
    : nextSection < 0 ? "" : changelog.slice(nextSection + 1);
  const unreleased = withUnreleased ? "## Unreleased\n\n- Test release note.\n\n" : "";
  writeFileSync(changelogPath, `${before}${unreleased}${after}`);
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
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  assert.match(changelog, new RegExp(`^## ${target.replaceAll(".", "\\.")} - 2026-07-16$`, "mu"));
  assert.equal(/^## (.+)$/mu.exec(changelog)?.[1], `${target} - 2026-07-16`);
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

void test("fixture keeps a new release first when the source has no Unreleased section", () => {
  const root = fixture(true, true);
  execFileSync(process.execPath, [script, "patch", "--date", "2026-07-16", "--root", root]);
  const version = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  assert.equal(/^## (.+)$/mu.exec(changelog)?.[1], `${version} - 2026-07-16`);
  execFileSync(process.execPath, [script, "--check", "--root", root]);
});
