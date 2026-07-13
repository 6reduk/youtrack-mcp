import assert from "node:assert/strict";
import { test } from "node:test";

import { createOperationResult, createReadSuccess } from "../../src/domain/operation-result.js";

void test("creates a complete read envelope with stable empty fields", () => {
  const result = createReadSuccess("read_something", "request-1", { value: 42 });
  assert.deepEqual(result, {
    status: "ok",
    operation: "read_something",
    target: null,
    data: { value: 42 },
    before: null,
    after: null,
    verified: null,
    warnings: [],
    candidates: [],
    journal: [],
    error: null,
    requestId: "request-1",
    page: null,
  });
});

void test("preserves mutation evidence, candidates, journal and safe errors", () => {
  const result = createOperationResult({
    status: "failed",
    operation: "change_one_thing",
    requestId: "request-2",
    target: { kind: "issue", id: "opaque-id" },
    before: { value: "before" },
    after: { value: "after" },
    verified: false,
    warnings: [{ kind: "best_effort_guard", message: "No atomic precondition" }],
    candidates: [{ kind: "field", id: "candidate-id", name: "Candidate" }],
    journal: [{ name: "write", status: "unknown", verified: null }],
    error: {
      kind: "mutation_outcome_unknown",
      message: "Outcome could not be established",
      httpStatus: null,
      retryable: false,
      details: {},
    },
  });

  assert.equal(result.status, "failed");
  assert.equal(result.verified, false);
  assert.equal(result.journal[0]?.status, "unknown");
  assert.equal(result.error?.kind, "mutation_outcome_unknown");
});
