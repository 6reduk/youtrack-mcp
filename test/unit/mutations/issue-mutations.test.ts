import assert from "node:assert/strict";
import test from "node:test";
import { createIssue } from "../../../src/application/mutations/create-issue.js";
import { updateIssue } from "../../../src/application/mutations/update-issue.js";
import { ISSUE_A, PROJECT_A } from "../reads/fakes.js";
import { MutationFakeGateway, issueWith, mutationContext } from "./fakes.js";

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

void test("update preserves omitted fields and verifies only requested facts", async () => {
  const gateway = new MutationFakeGateway();
  gateway.afterIssue = issueWith({ summary: "Changed", description: ISSUE_A.description });
  const result = await updateIssue(mutationContext(gateway), {
    issue: { id: ISSUE_A.id }, summary: { action: "set", value: "Changed" },
  });
  assert.equal(result.status, "updated");
  assert.deepEqual(gateway.updateCalls[0]?.command, { summary: "Changed" });
});
