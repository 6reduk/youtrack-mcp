import assert from "node:assert/strict";
import test from "node:test";
import { validateFieldChange } from "../../src/domain/field-values.js";
import { issueCustomFieldType } from "../../src/application/mutations/support.js";
import { hashResolvedPlan, type ResolvedPlanV1 } from "../../src/domain/execute-plan.js";
import { SCHEMA_A, SCHEMA_B } from "./fixtures.js";
import { readFileSync } from "node:fs";
void test("the same runtime codecs accept unrelated IDs, names and cardinalities", () => {
  const a = SCHEMA_A[0], b = SCHEMA_B[0]; assert.ok(a); assert.ok(b);
  assert.equal(issueCustomFieldType(a.fieldType), "SingleEnumIssueCustomField");
  assert.equal(issueCustomFieldType(b.fieldType), "MultiEnumIssueCustomField");
  assert.equal(validateFieldChange(a, { field: { id: a.id }, action: "set", value: { kind: "entity", selector: { id: "a-next" } } }).valid, true);
  assert.equal(validateFieldChange(b, { field: { id: b.id }, action: "set", value: { kind: "multi", values: [{ kind: "entity", selector: { id: "z-one" } }, { kind: "entity", selector: { id: "z-two" } }] } }).valid, true);
});

void test("agile audit runtime has no tenant-specific project or workflow constants", () => {
  const files = [
    "src/domain/agile-audit.ts",
    "src/application/reads/get-agile-board.ts",
    "src/application/reads/get-project-team.ts",
    "src/application/reads/list-issue-activities.ts",
    "src/infrastructure/youtrack/gateway.ts",
    "src/server/register-read-tools.ts",
    "src/domain/execute-plan.ts",
    "src/application/mutations/execute-plan-planner.ts",
    "src/application/mutations/execute-plan.ts",
    "src/server/register-mutation-tools.ts",
  ];
  const runtime = files.map((file) => readFileSync(file, "utf8")).join("\n");
  for (const forbidden of [/\bFinit\b/iu, /\bDEV\b/u, /\bIn Progress\b/iu, /\bDone\b/iu]) {
    assert.doesNotMatch(runtime, forbidden);
  }
});

void test("execute-plan canonical runtime accepts unrelated synthetic identities", () => {
  const plans: readonly ResolvedPlanV1[] = [
    {
      version: 1,
      operations: [{
        index: 0,
        operationId: "tenant-orchid-step",
        inputKind: "add_tag",
        kind: "tag_membership",
        subjectIssueId: "orchid-issue-91",
        expectedUpdatedAt: 918_273,
        tagId: "orchid-marker-7",
        desiredPresent: true,
      }],
    },
    {
      version: 1,
      operations: [{
        index: 0,
        operationId: "tenant-quartz-step",
        inputKind: "add_link",
        kind: "issue_link",
        subjectIssueId: "quartz-source-11",
        expectedUpdatedAt: 564_738,
        targetIssueId: "quartz-target-12",
        linkTypeId: "quartz-relation-3",
        direction: "target_to_source",
        desiredPresent: true,
        preventCycle: true,
      }],
    },
  ];
  const hashes = plans.map(hashResolvedPlan);
  assert.equal(hashes.every((hash) => /^[0-9a-f]{64}$/.test(hash)), true);
  assert.notEqual(hashes[0], hashes[1]);
});
