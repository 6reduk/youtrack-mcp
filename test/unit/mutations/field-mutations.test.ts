import assert from "node:assert/strict";
import test from "node:test";
import { setAssignee } from "../../../src/application/mutations/set-assignee.js";
import { setIssueState } from "../../../src/application/mutations/set-issue-state.js";
import { setCustomField } from "../../../src/application/mutations/set-custom-field.js";
import { ISSUE_A, USER_A } from "../reads/fakes.js";
import { ENUM_FIELD, MutationFakeGateway, USER_FIELD, issueWith, mutationContext } from "./fakes.js";

function partialGateway(field = ENUM_FIELD): MutationFakeGateway {
  const gateway = new MutationFakeGateway();
  gateway.adminSchema = {
    source: { kind: "admin_project_fields", outcome: "empty" },
    schemaComplete: false,
    fields: [],
  };
  gateway.probeSchema = {
    issueId: ISSUE_A.id,
    projectId: ISSUE_A.project.id,
    source: { kind: "probe_issue", outcome: "partial" },
    schemaComplete: false,
    fields: [{ ...field, valuesComplete: false, provenance: ["probe_issue"] }],
  };
  return gateway;
}

void test("entity field resolves exact allowed ID and serializes official issue field type", async () => {
  const gateway = new MutationFakeGateway();
  gateway.afterIssue = issueWith({ customFields: [{
    id: ENUM_FIELD.id, name: ENUM_FIELD.name, fieldType: ENUM_FIELD.fieldType, valueType: ENUM_FIELD.valueType,
    value: { kind: "entity", selector: { id: "choice-next-id" } }, rawType: "SingleEnumIssueCustomField",
  }] });
  const result = await setCustomField(mutationContext(gateway), {
    issue: { id: ISSUE_A.id },
    change: { field: { id: ENUM_FIELD.id }, action: "set", value: { kind: "entity", selector: { exactName: "Choice Next" } } },
  });
  assert.equal(result.status, "updated");
  const call = gateway.updateCalls[0];
  assert.ok(call);
  const fieldChange = call.command.customFields?.[0];
  assert.ok(fieldChange);
  assert.equal(fieldChange.$type, "SingleEnumIssueCustomField");
  assert.deepEqual(fieldChange.value, { id: "choice-next-id" });
});

void test("state wrapper resolves by actual value type, never field name", async () => {
  const gateway = new MutationFakeGateway();
  gateway.adminSchema = { ...gateway.adminSchema, fields: [{ ...ENUM_FIELD, fieldType: "state[1]", valueType: "state" }] };
  gateway.afterIssue = issueWith({ customFields: [{
    id: ENUM_FIELD.id, name: ENUM_FIELD.name, fieldType: "state[1]", valueType: "state",
    value: { kind: "entity", selector: { id: "choice-next-id" } }, rawType: "StateIssueCustomField",
  }] });
  const result = await setIssueState(mutationContext(gateway), {
    issue: { id: ISSUE_A.id }, value: { id: "choice-next-id" },
  });
  assert.equal(result.status, "updated");
});

void test("assignee wrapper resolves a single-user field and exact user", async () => {
  const gateway = new MutationFakeGateway();
  gateway.adminSchema = { ...gateway.adminSchema, fields: [USER_FIELD] };
  gateway.afterIssue = issueWith({ customFields: [{
    id: USER_FIELD.id, name: USER_FIELD.name, fieldType: USER_FIELD.fieldType, valueType: USER_FIELD.valueType,
    value: { kind: "user", selector: { id: USER_A.id } }, rawType: "SingleUserIssueCustomField",
  }] });
  const result = await setAssignee(mutationContext(gateway), {
    issue: { id: ISSUE_A.id }, action: "set", user: { login: USER_A.login },
  });
  assert.equal(result.status, "updated");
  assert.deepEqual(gateway.updateCalls[0]?.command.customFields?.[0]?.value, { id: USER_A.id });
});

void test("partial target evidence authorizes an explicit observed state field and value", async () => {
  const stateField = { ...ENUM_FIELD, fieldType: "state[1]", valueType: "state" };
  const gateway = partialGateway(stateField);
  const result = await setIssueState(mutationContext(gateway), {
    issue: { id: ISSUE_A.id }, field: { id: stateField.id }, value: { id: "choice-next-id" }, dryRun: true,
  });
  assert.equal(result.status, "ok");
  assert.deepEqual(result.warnings.map((warning) => warning.kind), ["schema_partial"]);
  assert.equal(gateway.issueReads, 1);
  assert.equal(gateway.probeSchemaCalls, 1);
  assert.equal(gateway.updateCalls.length, 0);
});

void test("partial target evidence rejects unobserved fields and values", async () => {
  const stateField = { ...ENUM_FIELD, fieldType: "state[1]", valueType: "state" };
  const missingFieldGateway = partialGateway(stateField);
  await assert.rejects(setIssueState(mutationContext(missingFieldGateway), {
    issue: { id: ISSUE_A.id }, field: { id: "unobserved-field" }, value: { id: "choice-next-id" }, dryRun: true,
  }), /field_evidence_not_found/u);

  const missingValueGateway = partialGateway(stateField);
  await assert.rejects(setIssueState(mutationContext(missingValueGateway), {
    issue: { id: ISSUE_A.id }, field: { id: stateField.id }, value: { id: "unobserved-value" }, dryRun: true,
  }), /allowed_values_incomplete/u);
  assert.equal(missingFieldGateway.updateCalls.length + missingValueGateway.updateCalls.length, 0);
});

void test("partial target evidence rejects ambiguous fields and entity values", async () => {
  const stateField = { ...ENUM_FIELD, fieldType: "state[1]", valueType: "state" };
  const ambiguousFieldGateway = partialGateway(stateField);
  assert.ok(ambiguousFieldGateway.probeSchema);
  ambiguousFieldGateway.probeSchema = {
    ...ambiguousFieldGateway.probeSchema,
    fields: [stateField, { ...stateField, id: "second-state-field-id" }],
  };
  await assert.rejects(setIssueState(mutationContext(ambiguousFieldGateway), {
    issue: { id: ISSUE_A.id }, field: { exactName: stateField.name }, value: { id: "choice-next-id" }, dryRun: true,
  }), /field_ambiguous/u);

  const ambiguousValueGateway = partialGateway({
    ...stateField,
    allowedValues: [
      { id: "first-choice-id", name: "Duplicate choice", kind: "StateBundleElement" },
      { id: "second-choice-id", name: "Duplicate choice", kind: "StateBundleElement" },
    ],
  });
  await assert.rejects(setIssueState(mutationContext(ambiguousValueGateway), {
    issue: { id: ISSUE_A.id }, field: { id: stateField.id }, value: { exactName: "Duplicate choice" }, dryRun: true,
  }), /field_value_ambiguous/u);
  assert.equal(ambiguousFieldGateway.updateCalls.length + ambiguousValueGateway.updateCalls.length, 0);
});

void test("clear rejects fields with unknown cardinality or value shape", async () => {
  for (const field of [
    { ...ENUM_FIELD, cardinality: "unknown" as const },
    { ...ENUM_FIELD, valueType: "unknown", valueShape: "unknown" as const },
  ]) {
    const gateway = new MutationFakeGateway();
    gateway.adminSchema = { ...gateway.adminSchema, fields: [field] };
    await assert.rejects(setCustomField(mutationContext(gateway), {
      issue: { id: ISSUE_A.id }, change: { field: { id: field.id }, action: "clear" }, dryRun: true,
    }), /unknown_(?:cardinality|value_shape)/u);
    assert.equal(gateway.updateCalls.length, 0);
  }
});

void test("partial state and assignee wrappers require an explicit field selector", async () => {
  const stateGateway = partialGateway({ ...ENUM_FIELD, fieldType: "state[1]", valueType: "state" });
  await assert.rejects(setIssueState(mutationContext(stateGateway), {
    issue: { id: ISSUE_A.id }, value: { id: "choice-next-id" }, dryRun: true,
  }), /field_selector_required_for_partial_schema/u);

  const userGateway = partialGateway(USER_FIELD);
  await assert.rejects(setAssignee(mutationContext(userGateway), {
    issue: { id: ISSUE_A.id }, action: "set", user: { id: USER_A.id }, dryRun: true,
  }), /field_selector_required_for_partial_schema/u);
  assert.equal(stateGateway.updateCalls.length + userGateway.updateCalls.length, 0);
});

void test("partial assignee accepts an exact active user with an explicit assignability warning", async () => {
  const gateway = partialGateway({ ...USER_FIELD, allowedValues: [] });
  const result = await setAssignee(mutationContext(gateway), {
    issue: { id: ISSUE_A.id }, field: { id: USER_FIELD.id }, action: "set", user: { login: USER_A.login }, dryRun: true,
  });
  assert.equal(result.status, "ok");
  assert.deepEqual(result.warnings.map((warning) => warning.kind), ["schema_partial", "user_assignability_unverified"]);
  assert.equal(gateway.issueReads, 1);
  assert.equal(gateway.updateCalls.length, 0);
});

void test("partial assignee rejects banned users before writing", async () => {
  const gateway = partialGateway({ ...USER_FIELD, allowedValues: [] });
  gateway.users = { items: [{ ...USER_A, banned: true }], hasMore: false };
  await assert.rejects(setAssignee(mutationContext(gateway), {
    issue: { id: ISSUE_A.id }, field: { id: USER_FIELD.id }, action: "set", user: { id: USER_A.id }, dryRun: true,
  }), /user_banned/u);
  assert.equal(gateway.updateCalls.length, 0);
});

void test("partial assignee rejects missing, ambiguous, and paginated user results", async () => {
  for (const users of [
    { items: [], hasMore: false },
    { items: [USER_A, { ...USER_A, name: "Duplicate" }], hasMore: false },
    { items: [USER_A], hasMore: true },
  ]) {
    const gateway = partialGateway({ ...USER_FIELD, allowedValues: [] });
    gateway.users = users;
    await assert.rejects(setAssignee(mutationContext(gateway), {
      issue: { id: ISSUE_A.id }, field: { id: USER_FIELD.id }, action: "set", user: { id: USER_A.id }, dryRun: true,
    }), /user_(?:not_found|ambiguous)/u);
    assert.equal(gateway.updateCalls.length, 0);
  }
});

void test("complete user bundle still rejects a resolved user absent from allowed values", async () => {
  const gateway = new MutationFakeGateway();
  gateway.adminSchema = { ...gateway.adminSchema, fields: [{ ...USER_FIELD, allowedValues: [] }] };
  await assert.rejects(setAssignee(mutationContext(gateway), {
    issue: { id: ISSUE_A.id }, field: { id: USER_FIELD.id }, action: "set", user: { id: USER_A.id }, dryRun: true,
  }), /user_not_allowed_for_field/u);
  assert.equal(gateway.updateCalls.length, 0);
});
