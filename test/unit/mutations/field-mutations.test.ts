import assert from "node:assert/strict";
import test from "node:test";
import { setAssignee } from "../../../src/application/mutations/set-assignee.js";
import { setIssueState } from "../../../src/application/mutations/set-issue-state.js";
import { setCustomField } from "../../../src/application/mutations/set-custom-field.js";
import { ISSUE_A, USER_A } from "../reads/fakes.js";
import { ENUM_FIELD, MutationFakeGateway, USER_FIELD, issueWith, mutationContext } from "./fakes.js";

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
