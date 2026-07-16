import assert from "node:assert/strict";
import test from "node:test";
import { createIssue } from "../../../src/application/mutations/create-issue.js";
import { updateIssue } from "../../../src/application/mutations/update-issue.js";
import { ISSUE_A, PROJECT_A } from "../reads/fakes.js";
import { ENUM_FIELD, MutationFakeGateway, issueWith, mutationContext } from "./fakes.js";

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
