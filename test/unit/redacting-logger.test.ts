import assert from "node:assert/strict";
import { test } from "node:test";

import { RedactingLogger } from "../../src/infrastructure/logging/redacting-logger.js";

const FIXED_DATE = new Date("2026-07-13T10:00:00.000Z");

void test("redacts sensitive keys, bearer credentials, configured secrets and errors", () => {
  const lines: string[] = [];
  const token = "permanent-token-value";
  const logger = new RedactingLogger({
    level: "debug",
    secrets: [token],
    sink: (line) => lines.push(line),
    now: () => FIXED_DATE,
  });

  logger.info(`request failed for ${token}`, {
    authorization: `Bearer ${token}`,
    nested: {
      cookie: "session=secret",
      safe: `Bearer ${token}`,
      error: new Error(`upstream returned ${token}`),
    },
  });

  assert.equal(lines.length, 1);
  const line = lines[0] ?? "";
  assert.doesNotMatch(line, /permanent-token-value|session=secret/);
  assert.match(line, /\[REDACTED\]/);

  const record = JSON.parse(line) as Record<string, unknown>;
  assert.equal(record.timestamp, FIXED_DATE.toISOString());
  assert.equal(record.level, "info");
});

void test("honors level filtering and handles circular values", () => {
  const lines: string[] = [];
  const logger = new RedactingLogger({ level: "warn", sink: (line) => lines.push(line) });
  const details: Record<string, unknown> = {};
  details.self = details;

  logger.debug("hidden", details);
  logger.warn("visible", details);

  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? "", /\[CIRCULAR\]/);
});
