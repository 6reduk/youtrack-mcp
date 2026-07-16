import assert from "node:assert/strict";
import test from "node:test";
import { createIssue } from "../../../src/application/mutations/create-issue.js";
import { updateIssue } from "../../../src/application/mutations/update-issue.js";
import { ISSUE_A, PROJECT_A, USER_A } from "../reads/fakes.js";
import { ENUM_FIELD, MutationFakeGateway, USER_FIELD, issueWith, mutationContext } from "./fakes.js";

function partialGateway(): MutationFakeGateway {
  const gateway = new MutationFakeGateway();
  gateway.adminSchema = {
    source: { kind: "admin_project_fields", outcome: "empty" },
    schemaComplete: false,
    fields: [],
  };
  gateway.probeSchema = {
    issueId: ISSUE_A.idReadable,
    projectId: PROJECT_A.id,
    source: { kind: "probe_issue", outcome: "partial" },
    schemaComplete: false,
    fields: [{ ...ENUM_FIELD, valuesComplete: false, provenance: ["probe_issue"] }],
  };
  return gateway;
}

void test("create dry run is normalized and performs no write", async () => {
  const gateway = new MutationFakeGateway();
  gateway.adminSchema = { ...gateway.adminSchema, fields: gateway.adminSchema.fields.map((field) => ({ ...field, required: false })) };
  const result = await createIssue(mutationContext(gateway), {
    project: { id: PROJECT_A.id }, summary: "New issue", description: "Body", dryRun: true,
  });
  assert.equal(result.status, "ok");
  assert.equal(result.data?.plan.writeCount, 1);
  assert.equal(gateway.createCalls.length, 0);
});

void test("create writes exactly once and verifies the returned issue", async () => {
  const gateway = new MutationFakeGateway();
  gateway.adminSchema = { ...gateway.adminSchema, fields: gateway.adminSchema.fields.map((field) => ({ ...field, required: false })) };
  gateway.afterIssue = issueWith({ summary: "New issue", description: "Body" });
  const result = await createIssue(mutationContext(gateway), {
    project: { shortName: PROJECT_A.shortName }, summary: "New issue", description: "Body",
  });
  assert.equal(result.status, "created");
  assert.equal(gateway.createCalls.length, 1);
});

void test("complete schema still rejects a missing required field", async () => {
  const gateway = new MutationFakeGateway();
  gateway.adminSchema = {
    ...gateway.adminSchema,
    fields: [{ ...ENUM_FIELD, required: true, hasDefaultValue: false }],
  };
  await assert.rejects(createIssue(mutationContext(gateway), {
    project: { id: PROJECT_A.id }, summary: "New issue", description: "Body", dryRun: true,
  }), /required_custom_fields_missing/u);
  assert.equal(gateway.createCalls.length, 0);
});

void test("partial schema permits create without custom fields and reports limitations", async () => {
  const gateway = partialGateway();
  const result = await createIssue(mutationContext(gateway), {
    project: { id: PROJECT_A.id }, summary: "New issue", description: "Body", dryRun: true,
  });
  assert.equal(result.status, "ok");
  assert.equal(gateway.probeSchemaCalls, 0);
  assert.equal(gateway.createCalls.length, 0);
  assert.deepEqual(result.warnings.map((warning) => warning.kind), ["schema_partial", "required_fields_unverified"]);
});

void test("partial schema accepts only exact same-project probe field and value evidence", async () => {
  const gateway = partialGateway();
  const result = await createIssue(mutationContext(gateway), {
    project: { id: PROJECT_A.id }, summary: "New issue", description: "Body",
    customFields: [{
      field: { id: ENUM_FIELD.id }, action: "set",
      value: { kind: "entity", selector: { id: "choice-next-id" } },
    }],
    probeIssue: { idReadable: ISSUE_A.idReadable }, dryRun: true,
  });
  assert.equal(result.status, "ok");
  assert.deepEqual(gateway.probeSelectors, [{ idReadable: ISSUE_A.idReadable }]);
  assert.equal(result.warnings[0]?.kind, "schema_partial");
  assert.deepEqual(result.warnings[0].details, { source: "probe_issue", probeIssueId: ISSUE_A.idReadable });
  assert.equal(gateway.createCalls.length, 0);
});

void test("partial create prepares exact state, type, and active assignee fields from one probe", async () => {
  const gateway = partialGateway();
  const stateField = { ...ENUM_FIELD, id: "state-field-id", name: "State field", fieldType: "state[1]", valueType: "state" };
  const typeField = { ...ENUM_FIELD, id: "type-field-id", name: "Type field" };
  const userField = { ...USER_FIELD, valuesComplete: false, allowedValues: [], provenance: ["probe_issue" as const] };
  assert.ok(gateway.probeSchema);
  gateway.probeSchema = { ...gateway.probeSchema, fields: [stateField, typeField, userField] };
  const result = await createIssue(mutationContext(gateway), {
    project: { id: PROJECT_A.id }, summary: "New issue", description: "Body",
    customFields: [
      { field: { id: stateField.id }, action: "set", value: { kind: "entity", selector: { id: "choice-next-id" } } },
      { field: { id: typeField.id }, action: "set", value: { kind: "entity", selector: { exactName: "Choice Next" } } },
      { field: { id: userField.id }, action: "set", value: { kind: "user", selector: { login: USER_A.login } } },
    ],
    probeIssue: { id: ISSUE_A.id }, dryRun: true,
  });
  assert.equal(result.status, "ok");
  assert.deepEqual(result.warnings.map((warning) => warning.kind), [
    "schema_partial", "required_fields_unverified", "user_assignability_unverified",
  ]);
  assert.equal(gateway.probeSchemaCalls, 1);
  assert.equal(gateway.createCalls.length, 0);
});

void test("partial create fails closed for missing or cross-project probe evidence", async () => {
  const missing = partialGateway();
  missing.probeSchema = null;
  const input = {
    project: { id: PROJECT_A.id }, summary: "New issue", description: "Body",
    customFields: [{
      field: { id: ENUM_FIELD.id }, action: "set" as const,
      value: { kind: "entity" as const, selector: { id: "choice-next-id" } },
    }],
    probeIssue: { idReadable: ISSUE_A.idReadable }, dryRun: true,
  };
  await assert.rejects(createIssue(mutationContext(missing), input), /probe_issue_not_found/u);
  const mismatch = partialGateway();
  assert.ok(mismatch.probeSchema);
  mismatch.probeSchema = { ...mismatch.probeSchema, projectId: "different-project-id" };
  await assert.rejects(createIssue(mutationContext(mismatch), input), /probe_project_mismatch/u);
  assert.equal(missing.createCalls.length + mismatch.createCalls.length, 0);
});

void test("partial create requires a probe and rejects values absent from evidence", async () => {
  const gateway = partialGateway();
  const change = {
    field: { id: ENUM_FIELD.id }, action: "set" as const,
    value: { kind: "entity" as const, selector: { id: "unobserved-value" } },
  };
  await assert.rejects(createIssue(mutationContext(gateway), {
    project: { id: PROJECT_A.id }, summary: "New issue", description: "Body", customFields: [change], dryRun: true,
  }), /probe_issue_required_for_partial_schema/u);
  await assert.rejects(createIssue(mutationContext(gateway), {
    project: { id: PROJECT_A.id }, summary: "New issue", description: "Body",
    customFields: [change], probeIssue: { id: ISSUE_A.id }, dryRun: true,
  }), /allowed_values_incomplete/u);
  assert.equal(gateway.createCalls.length, 0);
});

void test("update preserves omitted fields and verifies only requested facts", async () => {
  const gateway = new MutationFakeGateway();
  gateway.afterIssue = issueWith({ summary: "Changed", description: ISSUE_A.description });
  const result = await updateIssue(mutationContext(gateway), {
    issue: { id: ISSUE_A.id }, summary: { action: "set", value: "Changed" },
  });
  assert.equal(result.status, "updated");
  assert.deepEqual(gateway.updateCalls[0]?.command, { summary: "Changed" });
});

void test("partial update uses one target probe for multiple observed field changes", async () => {
  const gateway = partialGateway();
  const secondField = {
    ...ENUM_FIELD,
    id: "field-second-id",
    name: "Second field",
    allowedValues: [{ id: "second-value-id", name: "Second value", kind: "EnumBundleElement" }],
  };
  assert.ok(gateway.probeSchema);
  const firstField = gateway.probeSchema.fields[0];
  assert.ok(firstField);
  gateway.probeSchema = { ...gateway.probeSchema, fields: [firstField, secondField] };
  gateway.afterIssue = issueWith({ customFields: [
    { id: ENUM_FIELD.id, name: ENUM_FIELD.name, fieldType: ENUM_FIELD.fieldType, valueType: ENUM_FIELD.valueType, value: { kind: "entity", selector: { id: "choice-next-id" } }, rawType: "SingleEnumIssueCustomField" },
    { id: secondField.id, name: secondField.name, fieldType: secondField.fieldType, valueType: secondField.valueType, value: { kind: "entity", selector: { id: "second-value-id" } }, rawType: "SingleEnumIssueCustomField" },
  ] });
  const result = await updateIssue(mutationContext(gateway), {
    issue: { id: ISSUE_A.id },
    customFields: [
      { field: { id: ENUM_FIELD.id }, action: "set", value: { kind: "entity", selector: { id: "choice-next-id" } } },
      { field: { id: secondField.id }, action: "set", value: { kind: "entity", selector: { id: "second-value-id" } } },
    ],
  });
  assert.equal(result.status, "updated");
  assert.deepEqual(result.warnings.map((warning) => warning.kind), ["schema_partial"]);
  assert.equal(gateway.issueReads, 2);
  assert.equal(gateway.probeSchemaCalls, 1);
  assert.equal(gateway.updateCalls.length, 1);
});
