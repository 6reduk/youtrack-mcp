import assert from "node:assert/strict";
import test from "node:test";

import { planExecutePlan, type PlanOperation } from "../../../src/application/mutations/execute-plan-planner.js";
import type { FieldDefinition } from "../../../src/domain/project-schema.js";
import { ISSUE_A, LINK_TYPE_A, TAG_A, USER_A } from "../reads/fakes.js";
import { ENUM_FIELD, MutationFakeGateway, USER_FIELD, mutationContext } from "./fakes.js";

const STATE_FIELD: FieldDefinition = {
  ...ENUM_FIELD,
  id: "field-state-id",
  name: "Workflow state",
  fieldType: "state[1]",
  valueType: "state",
};

function issue(id: string, updatedAt = 2) {
  return { ...ISSUE_A, id, idReadable: `NEUTRAL-${id}`, updatedAt };
}

function gatewayFor(...ids: string[]): MutationFakeGateway {
  const gateway = new MutationFakeGateway();
  gateway.adminSchema = { ...gateway.adminSchema, fields: [ENUM_FIELD, USER_FIELD, STATE_FIELD] };
  for (const id of ids) gateway.issuesById.set(id, issue(id));
  gateway.tags = { items: [TAG_A], hasMore: false };
  gateway.linkTypes = { items: [LINK_TYPE_A], hasMore: false };
  return gateway;
}

void test("planner normalizes all eight variants into the three canonical forms", async () => {
  const cases: readonly { operation: PlanOperation; canonical: string; inputKind: string }[] = [
    { inputKind: "update_issue", canonical: "update_issue", operation: { kind: "update_issue", issue: { id: "a" }, expectedUpdatedAt: 2, summary: { action: "set", value: "Changed" } } },
    { inputKind: "set_custom_field", canonical: "update_issue", operation: { kind: "set_custom_field", issue: { id: "a" }, expectedUpdatedAt: 2, change: { field: { id: ENUM_FIELD.id }, action: "set", value: { kind: "entity", selector: { id: "choice-next-id" } } } } },
    { inputKind: "set_issue_state", canonical: "update_issue", operation: { kind: "set_issue_state", issue: { id: "a" }, expectedUpdatedAt: 2, field: { id: STATE_FIELD.id }, value: { id: "choice-next-id" } } },
    { inputKind: "set_assignee", canonical: "update_issue", operation: { kind: "set_assignee", issue: { id: "a" }, expectedUpdatedAt: 2, field: { id: USER_FIELD.id }, action: "set", user: { id: USER_A.id } } },
    { inputKind: "add_tag", canonical: "tag_membership", operation: { kind: "add_tag", issue: { id: "a" }, expectedUpdatedAt: 2, tag: { id: TAG_A.id } } },
    { inputKind: "remove_tag", canonical: "tag_membership", operation: { kind: "remove_tag", issue: { id: "a" }, expectedUpdatedAt: 2, tag: { id: TAG_A.id } } },
    { inputKind: "add_link", canonical: "issue_link", operation: { kind: "add_link", source: { id: "a" }, target: { id: "b" }, expectedUpdatedAt: 2, linkType: { id: LINK_TYPE_A.id }, direction: "source_to_target" } },
    { inputKind: "remove_link", canonical: "issue_link", operation: { kind: "remove_link", source: { id: "a" }, target: { id: "b" }, expectedUpdatedAt: 2, linkType: { id: LINK_TYPE_A.id }, direction: "source_to_target", expectedExisting: true } },
  ];
  for (const item of cases) {
    const gateway = gatewayFor("a", "b");
    if (item.inputKind === "remove_tag") gateway.issueTagsById.set("a", [TAG_A]);
    if (item.inputKind === "remove_link") {
      gateway.issueLinksById.set("a", [{ id: "container-a", type: LINK_TYPE_A, direction: "source_to_target", source: issue("a"), target: issue("b") }]);
    }
    const result = await planExecutePlan(mutationContext(gateway), [item.operation]);
    assert.equal(result.ok, true, item.inputKind);
    assert.equal(result.plan.resolvedPlan.operations[0]?.kind, item.canonical);
    assert.equal(result.plan.resolvedPlan.operations[0].inputKind, item.inputKind);
    assert.match(result.plan.planHash, /^[0-9a-f]{64}$/u);
  }
});

void test("planner rejects duplicate IDs locally and duplicate resolved subjects after exact preflight", async () => {
  const duplicateIds = gatewayFor("a", "b");
  const first: PlanOperation = { kind: "update_issue", operationId: "same", issue: { id: "a" }, expectedUpdatedAt: 2, summary: { action: "set", value: "A" } };
  const second: PlanOperation = { kind: "add_tag", operationId: "same", issue: { id: "b" }, expectedUpdatedAt: 2, tag: { id: TAG_A.id } };
  const local = await planExecutePlan(mutationContext(duplicateIds), [first, second]);
  assert.equal(local.ok, false);
  assert.equal(local.failure.error.kind, "duplicate_operation_id");
  assert.equal(duplicateIds.events.length, 0);

  const duplicateSubject = gatewayFor("a");
  const resolved = await planExecutePlan(mutationContext(duplicateSubject), [
    { ...first, operationId: "one" },
    { kind: "add_tag", operationId: "two", issue: { id: "a" }, expectedUpdatedAt: 2, tag: { id: TAG_A.id } },
  ]);
  assert.equal(resolved.ok, false);
  assert.equal(resolved.failure.error.kind, "duplicate_mutation_subject");
});

void test("planner fails closed on missing exact selectors and incomplete bounded evidence", async () => {
  const missing = gatewayFor("a");
  missing.issuesById.set("missing", null);
  const absent = await planExecutePlan(mutationContext(missing), [{ kind: "add_tag", issue: { id: "missing" }, expectedUpdatedAt: 2, tag: { id: TAG_A.id } }]);
  assert.equal(absent.ok, false);
  assert.equal(absent.failure.error.kind, "issue_not_found");

  const incomplete = gatewayFor("a");
  incomplete.tags = { items: [TAG_A], hasMore: true };
  const result = await planExecutePlan(mutationContext(incomplete), [{ kind: "add_tag", issue: { id: "a" }, expectedUpdatedAt: 2, tag: { exactName: TAG_A.name } }]);
  assert.equal(result.ok, false);
  assert.equal(result.failure.error.kind, "tags_incomplete");
});

void test("planner requires a visible matching guard unless complete desired state is already proven", async () => {
  for (const [updatedAt, expected, kind] of [[null, 2, "updated_at_unavailable"], [3, 2, "updated_at_mismatch"]] as const) {
    const gateway = gatewayFor("a");
    gateway.issuesById.set("a", issue("a", updatedAt as number));
    if (updatedAt === null) gateway.issuesById.set("a", { ...issue("a"), updatedAt: null });
    const result = await planExecutePlan(mutationContext(gateway), [{ kind: "update_issue", issue: { id: "a" }, expectedUpdatedAt: expected, summary: { action: "set", value: "Changed" } }]);
    assert.equal(result.ok, false);
    assert.equal(result.failure.error.kind, kind);
  }
  const replay = gatewayFor("a");
  replay.issuesById.set("a", { ...issue("a", 999), summary: "Changed" });
  const result = await planExecutePlan(mutationContext(replay), [{ kind: "update_issue", issue: { id: "a" }, expectedUpdatedAt: 2, summary: { action: "set", value: "Changed" } }]);
  assert.equal(result.ok, true);
});

void test("partial schema evidence and warnings survive into a fully resolved plan", async () => {
  const gateway = gatewayFor("a");
  gateway.adminSchema = { source: { kind: "admin_project_fields", outcome: "empty" }, schemaComplete: false, fields: [] };
  gateway.probeSchema = { issueId: issue("a").idReadable, projectId: ISSUE_A.project.id, source: { kind: "probe_issue", outcome: "partial" }, schemaComplete: false, fields: [{ ...ENUM_FIELD, provenance: ["probe_issue"] }] };
  const result = await planExecutePlan(mutationContext(gateway), [{ kind: "set_custom_field", issue: { id: "a" }, expectedUpdatedAt: 2, change: { field: { id: ENUM_FIELD.id }, action: "set", value: { kind: "entity", selector: { id: "choice-next-id" } } } }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.operations[0]?.warnings.map((warning) => warning.kind), ["schema_partial"]);
});

void test("missing custom-field and unobserved description evidence cannot prove a clear", async () => {
  const customMissing = gatewayFor("a");
  customMissing.issuesById.set("a", { ...issue("a", 99), customFields: [], customFieldsObserved: true });
  const missing = await planExecutePlan(mutationContext(customMissing), [{
    kind: "set_custom_field", issue: { id: "a" }, expectedUpdatedAt: 2,
    change: { field: { id: ENUM_FIELD.id }, action: "clear" },
  }]);
  assert.equal(missing.ok, false);
  assert.equal(missing.failure.error.kind, "updated_at_mismatch");

  const explicitNull = gatewayFor("a");
  explicitNull.issuesById.set("a", { ...issue("a", 99), customFieldsObserved: true, customFields: [{ id: ENUM_FIELD.id, name: ENUM_FIELD.name, fieldType: ENUM_FIELD.fieldType, valueType: ENUM_FIELD.valueType, value: null, rawType: "SingleEnumIssueCustomField" }] });
  assert.equal((await planExecutePlan(mutationContext(explicitNull), [{ kind: "set_custom_field", issue: { id: "a" }, expectedUpdatedAt: 2, change: { field: { id: ENUM_FIELD.id }, action: "clear" } }])).ok, true);

  const hiddenDescription = gatewayFor("a");
  hiddenDescription.issuesById.set("a", { ...issue("a", 99), description: null, descriptionObserved: false });
  const hidden = await planExecutePlan(mutationContext(hiddenDescription), [{ kind: "update_issue", issue: { id: "a" }, expectedUpdatedAt: 2, description: { action: "clear" } }]);
  assert.equal(hidden.ok, false);
  assert.equal(hidden.failure.error.kind, "updated_at_mismatch");
});

void test("canonical payloads retain update postconditions, helper semantics, and defaults", async () => {
  const operations: readonly PlanOperation[] = [
    { kind: "update_issue", issue: { id: "a" }, expectedUpdatedAt: 2, summary: { action: "set", value: "New" }, description: { action: "clear" } },
    { kind: "set_custom_field", issue: { id: "b" }, expectedUpdatedAt: 2, change: { field: { id: ENUM_FIELD.id }, action: "set", value: { kind: "entity", selector: { id: "choice-next-id" } } } },
    { kind: "set_issue_state", issue: { id: "c" }, expectedUpdatedAt: 2, field: { id: STATE_FIELD.id }, value: { id: "choice-next-id" } },
    { kind: "set_assignee", issue: { id: "d" }, expectedUpdatedAt: 2, field: { id: USER_FIELD.id }, action: "clear" },
    { kind: "add_tag", issue: { id: "e" }, expectedUpdatedAt: 2, tag: { id: TAG_A.id } },
    { kind: "remove_tag", issue: { id: "f" }, expectedUpdatedAt: 2, tag: { id: TAG_A.id } },
    { kind: "add_link", source: { id: "g" }, target: { id: "target-g" }, expectedUpdatedAt: 2, linkType: { id: LINK_TYPE_A.id }, direction: "source_to_target" },
    { kind: "remove_link", source: { id: "h" }, target: { id: "target-h" }, expectedUpdatedAt: 2, linkType: { id: LINK_TYPE_A.id }, direction: "target_to_source", expectedExisting: true },
  ];
  const gateway = gatewayFor("a", "b", "c", "d", "e", "f", "g", "target-g", "h", "target-h");
  gateway.issueTagsById.set("f", [TAG_A]);
  gateway.issueLinksById.set("h", [{ id: "reverse-container", type: LINK_TYPE_A, direction: "target_to_source", source: issue("target-h"), target: issue("h") }]);
  const result = await planExecutePlan(mutationContext(gateway), operations);
  assert.equal(result.ok, true);
  const canonical = result.plan.resolvedPlan.operations;
  assert.deepEqual(canonical[0], { index: 0, operationId: null, inputKind: "update_issue", kind: "update_issue", subjectIssueId: "a", expectedUpdatedAt: 2, command: { summary: "New", description: null }, postconditions: [{ kind: "summary", value: "New" }, { kind: "description", value: null }] });
  assert.deepEqual(canonical[1]?.kind === "update_issue" ? { command: canonical[1].command, postconditions: canonical[1].postconditions } : null, { command: { customFields: [{ id: ENUM_FIELD.id, $type: "SingleEnumIssueCustomField", value: { id: "choice-next-id" } }] }, postconditions: [{ kind: "custom_field", fieldId: ENUM_FIELD.id, value: { id: "choice-next-id" } }] });
  assert.deepEqual(canonical[2]?.kind === "update_issue" ? { command: canonical[2].command, postconditions: canonical[2].postconditions } : null, { command: { customFields: [{ id: STATE_FIELD.id, $type: "StateIssueCustomField", value: { id: "choice-next-id" } }] }, postconditions: [{ kind: "custom_field", fieldId: STATE_FIELD.id, value: { id: "choice-next-id" } }] });
  assert.deepEqual(canonical[3]?.kind === "update_issue" ? { command: canonical[3].command, postconditions: canonical[3].postconditions } : null, { command: { customFields: [{ id: USER_FIELD.id, $type: "SingleUserIssueCustomField", value: null }] }, postconditions: [{ kind: "custom_field", fieldId: USER_FIELD.id, value: null }] });
  assert.deepEqual(canonical.slice(4, 6).map((entry) => entry.kind === "tag_membership" ? entry.desiredPresent : null), [true, false]);
  assert.deepEqual(canonical.slice(6).map((entry) => entry.kind === "issue_link" ? { direction: entry.direction, desiredPresent: entry.desiredPresent, preventCycle: entry.preventCycle } : null), [
    { direction: "source_to_target", desiredPresent: true, preventCycle: false },
    { direction: "target_to_source", desiredPresent: false, preventCycle: false },
  ]);
});

void test("duplicate fields are rejected after distinct selectors resolve to the same field", async () => {
  const result = await planExecutePlan(mutationContext(gatewayFor("a")), [{
    kind: "update_issue", issue: { id: "a" }, expectedUpdatedAt: 2,
    customFields: [
      { field: { id: ENUM_FIELD.id }, action: "clear" },
      { field: { exactName: ENUM_FIELD.name }, action: "clear" },
    ],
  }]);
  assert.equal(result.ok, false);
  assert.equal(result.failure.error.kind, "duplicate_field_change");
});

void test("planner accepts exactly 20 operations and rejects the 21st before HTTP", async () => {
  const ids = Array.from({ length: 20 }, (_, index) => `i${String(index)}`);
  const twenty = ids.map((id, index): PlanOperation => ({ kind: "update_issue", issue: { id }, expectedUpdatedAt: 2, summary: { action: "set", value: `v${String(index)}` } }));
  const complete = gatewayFor(...ids);
  assert.equal((await planExecutePlan(mutationContext(complete), twenty)).ok, true);
  const tooManyGateway = gatewayFor();
  const tooMany = await planExecutePlan(mutationContext(tooManyGateway), [...twenty, updateOperation("overflow")]);
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.failure.error.kind, "too_many_operations");
  assert.equal(tooManyGateway.events.length, 0);
});

function updateOperation(id: string): PlanOperation {
  return { kind: "update_issue", issue: { id }, expectedUpdatedAt: 2, summary: { action: "set", value: "v" } };
}

void test("incomplete subject tag/link collections and detected cycles fail closed", async () => {
  const tags = gatewayFor("a"); tags.tags = { items: [], hasMore: true };
  const tagResult = await planExecutePlan(mutationContext(tags), [{ kind: "add_tag", issue: { id: "a" }, expectedUpdatedAt: 2, tag: { id: TAG_A.id } }]);
  assert.equal(tagResult.ok, false); assert.equal(tagResult.failure.error.kind, "tags_incomplete");

  const links = gatewayFor("a", "b"); links.links = { items: [], hasMore: true };
  const linkResult = await planExecutePlan(mutationContext(links), [{ kind: "add_link", source: { id: "a" }, target: { id: "b" }, expectedUpdatedAt: 2, linkType: { id: LINK_TYPE_A.id }, direction: "source_to_target" }]);
  assert.equal(linkResult.ok, false); assert.equal(linkResult.failure.error.kind, "links_incomplete");

  const cycle = gatewayFor("a", "b");
  cycle.relatedIssues = { items: [{ id: "a", idReadable: "NEUTRAL-a", summary: "A", url: "https://tracker.example.test/a" }], hasMore: false };
  const cycleResult = await planExecutePlan(mutationContext(cycle), [{ kind: "add_link", source: { id: "a" }, target: { id: "b" }, expectedUpdatedAt: 2, linkType: { id: LINK_TYPE_A.id }, direction: "source_to_target", preventCycle: true }]);
  assert.equal(cycleResult.ok, false); assert.equal(cycleResult.failure.error.kind, "cycle_detected");
});

void test("partial assignee resolution retains schema and assignability warnings", async () => {
  const gateway = gatewayFor("a");
  gateway.adminSchema = { source: { kind: "admin_project_fields", outcome: "empty" }, schemaComplete: false, fields: [] };
  gateway.probeSchema = { issueId: issue("a").idReadable, projectId: ISSUE_A.project.id, source: { kind: "probe_issue", outcome: "partial" }, schemaComplete: false, fields: [{ ...USER_FIELD, allowedValues: [], valuesComplete: false, provenance: ["probe_issue"] }] };
  const result = await planExecutePlan(mutationContext(gateway), [{ kind: "set_assignee", issue: { id: "a" }, expectedUpdatedAt: 2, field: { id: USER_FIELD.id }, action: "set", user: { id: USER_A.id } }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.operations[0]?.warnings.map((warning) => warning.kind), ["schema_partial", "user_assignability_unverified"]);
});
