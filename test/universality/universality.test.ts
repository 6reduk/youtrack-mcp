import assert from "node:assert/strict";
import test from "node:test";
import { validateFieldChange } from "../../src/domain/field-values.js";
import { issueCustomFieldType } from "../../src/application/mutations/support.js";
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
  ];
  const runtime = files.map((file) => readFileSync(file, "utf8")).join("\n");
  for (const forbidden of [/\bFinit\b/iu, /\bDEV\b/u, /\bIn Progress\b/iu, /\bDone\b/iu]) {
    assert.doesNotMatch(runtime, forbidden);
  }
});
