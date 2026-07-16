import assert from "node:assert/strict";
import test from "node:test";
import { runIssueMutation } from "../../../src/application/mutation-runner.js";
import { verifyPostconditions } from "../../../src/domain/verification.js";
import { YouTrackHttpError } from "../../../src/infrastructure/http/error-mapper.js";
import { ISSUE_A } from "../reads/fakes.js";

void test("dry run and stale guard perform zero writes", async () => {
  let writes = 0;
  const common = {
    operation: "synthetic_mutation", requestId: "r", before: ISSUE_A,
    plan: { target: ISSUE_A.id, changes: ["summary"], writeCount: 1 },
    write: () => { writes += 1; return Promise.resolve(); },
    reread: () => Promise.resolve(ISSUE_A),
    verify: () => ({ verified: true, mismatches: [] }),
  };
  const warning = { kind: "schema_partial", message: "partial evidence" };
  const dry = await runIssueMutation({ ...common, guards: { dryRun: true }, warnings: [warning] });
  assert.equal(dry.status, "ok");
  assert.equal(dry.warnings[0]?.kind, "schema_partial");
  const conflict = await runIssueMutation({ ...common, guards: { expectedUpdatedAt: 999 }, warnings: [warning] });
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.warnings[0]?.kind, "schema_partial");
  assert.equal(writes, 0);
});

void test("uncertain write is never replayed and is decided by reconciliation", async () => {
  let writes = 0;
  const after = { ...ISSUE_A, summary: "After" };
  const result = await runIssueMutation({
    operation: "synthetic_mutation", requestId: "r", before: ISSUE_A, guards: {},
    warnings: [{ kind: "schema_partial", message: "partial evidence" }],
    plan: { target: ISSUE_A.id, changes: ["summary"], writeCount: 1 },
    write: () => {
      writes += 1;
      return Promise.reject(new YouTrackHttpError({ kind: "request_timeout", message: "timeout", status: null, retryable: false, requestId: "w" }));
    },
    reread: () => Promise.resolve(after),
    verify: (snapshot) => verifyPostconditions(snapshot, [{ name: "summary", expected: "After", observe: (issue) => issue.summary }]),
  });
  assert.equal(writes, 1);
  assert.equal(result.status, "updated");
  assert.equal(result.verified, true);
  assert.deepEqual(result.warnings.map((warning) => warning.kind), ["schema_partial", "write_response_uncertain_reconciled"]);
});
