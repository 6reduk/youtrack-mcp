import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const RELEASE_FILES = [
  "README.md",
  "examples/claude.example.json",
  "examples/codex.example.toml",
  "examples/kimi.example.json",
  "src/server/create-server.ts",
];

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const options = { check: false, dryRun: false, root: process.cwd(), date: localDate(), target: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") options.check = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--root") options.root = resolve(requireValue(argv, ++index, "--root"));
    else if (argument === "--date") options.date = requireValue(argv, ++index, "--date");
    else if (argument?.startsWith("-")) fail(`Unknown option: ${argument}`);
    else if (options.target === null) options.target = argument ?? null;
    else fail(`Unexpected argument: ${argument}`);
  }
  const parsedDate = new Date(`${options.date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(options.date)
    || Number.isNaN(parsedDate.valueOf())
    || parsedDate.toISOString().slice(0, 10) !== options.date) {
    fail(`Invalid release date: ${options.date}`);
  }
  if (options.check && options.target !== null) fail("--check does not accept a target version");
  if (!options.check && options.target === null) usage();
  return options;
}

function requireValue(argv, index, option) {
  const value = argv[index];
  if (value === undefined || value.startsWith("-")) fail(`${option} requires a value`);
  return value;
}

function usage() {
  fail("Usage: npm run version:bump -- <patch|minor|major|x.y.z> [--date YYYY-MM-DD] [--dry-run]");
}

function localDate() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${String(now.getFullYear())}-${month}-${day}`;
}

function parseVersion(version, label) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(version);
  if (match === null) fail(`${label} must be an exact stable SemVer (x.y.z): ${version}`);
  return match.slice(1).map(Number);
}

function nextVersion(current, target) {
  const [major, minor, patch] = parseVersion(current, "Current version");
  if (target === "major") return `${major + 1}.0.0`;
  if (target === "minor") return `${major}.${minor + 1}.0`;
  if (target === "patch") return `${major}.${minor}.${patch + 1}`;
  const requested = parseVersion(target, "Target version");
  const greater = requested[0] > major
    || (requested[0] === major && requested[1] > minor)
    || (requested[0] === major && requested[1] === minor && requested[2] > patch);
  if (!greater) fail(`Target version ${target} must be greater than ${current}`);
  return target;
}

function read(root, relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function replaceOnce(text, before, after, relativePath) {
  const first = text.indexOf(before);
  if (first < 0) fail(`${relativePath} does not contain expected value: ${before}`);
  if (text.indexOf(before, first + before.length) >= 0) fail(`${relativePath} contains the expected value more than once`);
  return text.replace(before, after);
}

function loadState(root) {
  const packageText = read(root, "package.json");
  const packageLockText = read(root, "package-lock.json");
  const packageJson = JSON.parse(packageText);
  const packageLock = JSON.parse(packageLockText);
  const current = packageJson.version;
  if (typeof current !== "string") fail("package.json has no string version");
  parseVersion(current, "Current version");
  if (packageLock.version !== current || packageLock.packages?.[""]?.version !== current) {
    fail("package-lock.json root versions do not match package.json");
  }
  return { current, packageText, packageLockText };
}

function validateReleaseReferences(root, current) {
  const expected = `@6reduk/youtrack-mcp@${current}`;
  for (const relativePath of RELEASE_FILES.slice(0, 4)) {
    if (!read(root, relativePath).includes(expected)) fail(`${relativePath} does not reference ${expected}`);
  }
  const serverVersion = `version: "${current}"`;
  if (!read(root, RELEASE_FILES[4]).includes(serverVersion)) fail(`${RELEASE_FILES[4]} does not reference ${serverVersion}`);
  const changelog = read(root, "CHANGELOG.md");
  const headings = [...changelog.matchAll(/^## (.+)$/gmu)].map((match) => match[1]);
  const firstRelease = headings.find((heading) => heading !== "Unreleased");
  if (!firstRelease?.startsWith(`${current} - `)) fail(`CHANGELOG.md latest release does not match ${current}`);
}

function prepareChanges(root, state, target, date) {
  const changes = new Map();
  const packageBefore = `"version": "${state.current}"`;
  const packageAfter = `"version": "${target}"`;
  changes.set("package.json", replaceOnce(state.packageText, packageBefore, packageAfter, "package.json"));

  const lockLines = state.packageLockText.split("\n");
  let replaced = 0;
  for (let index = 0; index < lockLines.length && replaced < 2; index += 1) {
    if (lockLines[index]?.includes(packageBefore)) {
      lockLines[index] = lockLines[index].replace(packageBefore, packageAfter);
      replaced += 1;
    }
  }
  if (replaced !== 2) fail("package-lock.json does not contain both root version fields");
  changes.set("package-lock.json", lockLines.join("\n"));

  const oldPackageReference = `@6reduk/youtrack-mcp@${state.current}`;
  const newPackageReference = `@6reduk/youtrack-mcp@${target}`;
  for (const relativePath of RELEASE_FILES.slice(0, 4)) {
    changes.set(relativePath, replaceOnce(read(root, relativePath), oldPackageReference, newPackageReference, relativePath));
  }
  const serverPath = RELEASE_FILES[4];
  changes.set(serverPath, replaceOnce(read(root, serverPath), `version: "${state.current}"`, `version: "${target}"`, serverPath));

  const changelog = read(root, "CHANGELOG.md");
  const unreleasedMatch = /^## Unreleased\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/mu.exec(changelog);
  if (unreleasedMatch === null) fail("CHANGELOG.md must contain a top-level '## Unreleased' section before bumping");
  if (!/^\s*-\s+\S/mu.test(unreleasedMatch[1])) fail("CHANGELOG.md Unreleased section must contain at least one bullet");
  changes.set("CHANGELOG.md", replaceOnce(changelog, "## Unreleased", `## ${target} - ${date}`, "CHANGELOG.md"));
  return changes;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const state = loadState(options.root);
  validateReleaseReferences(options.root, state.current);
  if (options.check) {
    process.stdout.write(`Version references are consistent: ${state.current}\n`);
    return;
  }
  const target = nextVersion(state.current, options.target);
  const changes = prepareChanges(options.root, state, target, options.date);
  if (!options.dryRun) {
    for (const [relativePath, contents] of changes) writeFileSync(resolve(options.root, relativePath), contents, "utf8");
  }
  process.stdout.write(`${options.dryRun ? "Would bump" : "Bumped"} ${state.current} -> ${target}\n`);
  for (const relativePath of changes.keys()) process.stdout.write(`- ${relativePath}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
