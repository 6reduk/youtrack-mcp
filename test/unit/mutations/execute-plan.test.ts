import assert from "node:assert/strict";
import test from "node:test";

import { executePlan } from "../../../src/application/mutations/execute-plan.js";
import type { PlanOperation } from "../../../src/application/mutations/execute-plan-planner.js";
import { YouTrackHttpError } from "../../../src/infrastructure/http/error-mapper.js";
import { ISSUE_A, LINK_TYPE_A, TAG_A } from "../reads/fakes.js";
import { MutationFakeGateway, mutationContext } from "./fakes.js";

function snapshot(id: string, summary = "Before", updatedAt: number | null = 2) {
  return { ...ISSUE_A, id, idReadable: `NEUTRAL-${id}`, summary, updatedAt };
}

function update(id: string, value: string, expectedUpdatedAt = 2): PlanOperation {
  return { kind: "update_issue", operationId: `op-${id}`, issue: { id }, expectedUpdatedAt, summary: { action: "set", value } };
}

function gateway(...ids: string[]): MutationFakeGateway {
  const value = new MutationFakeGateway();
  for (const id of ids) value.issuesById.set(id, snapshot(id));
  return value;
}

async function previewHash(operations: readonly PlanOperation[], source = gateway("a", "b", "c")): Promise<string> {
  const preview = await executePlan(mutationContext(source), { dryRun: true, operations });
  assert.equal(preview.status, "ok");
  assert.ok(preview.data?.planHash);
  return preview.data.planHash;
}

void test("preview is read-only; matching hash executes only after complete preflight", async () => {
  const operations = [update("a", "After A"), update("b", "After B")] as const;
  const hash = await previewHash(operations);
  const planGateway = gateway("a", "b");
  planGateway.issueReadQueues.set("a", [snapshot("a"), snapshot("a"), snapshot("a", "After A", 3)]);
  planGateway.issueReadQueues.set("b", [snapshot("b"), snapshot("b"), snapshot("b", "After B", 3)]);
  const result = await executePlan(mutationContext(planGateway), { dryRun: false, confirm: true, planHash: hash, operations });
  assert.equal(result.status, "updated");
  assert.equal(result.data?.completedWriteCount, 2);
  assert.deepEqual(result.data.operations.map((step) => step.status), ["updated", "updated"]);
  const firstWrite = planGateway.events.findIndex((event) => event.startsWith("write:"));
  assert.ok(firstWrite > planGateway.events.findIndex((event) => event.startsWith("read:b:")), planGateway.events.join("\n"));
  assert.deepEqual(planGateway.events.filter((event) => event.startsWith("write:")), ["write:update:a", "write:update:b"]);
  assert.deepEqual(result.journal.map((step) => step.status), ["completed", "completed"]);
});

void test("hash mismatch and invalid confirmation dispatch no writes", async () => {
  const operations = [update("a", "After")] as const;
  const wrong = await executePlan(mutationContext(gateway("a")), { dryRun: false, confirm: true, planHash: "0".repeat(64), operations });
  assert.equal(wrong.status, "conflict");
  assert.equal(wrong.error?.kind, "plan_hash_mismatch");
  assert.equal(wrong.data?.completedWriteCount, 0);
  assert.deepEqual(wrong.journal.map((entry) => entry.status), ["skipped"]);

  const malformed = await executePlan(mutationContext(gateway("a")), { dryRun: false, confirm: true, planHash: "NO", operations });
  assert.equal(malformed.status, "invalid");
  assert.equal(malformed.data?.completedWriteCount, 0);
});

void test("stale guard replay succeeds when fresh complete read already proves desired state", async () => {
  const operations = [update("a", "After")] as const;
  const hash = await previewHash(operations);
  const replay = gateway("a");
  replay.issuesById.set("a", snapshot("a", "After", 999));
  const result = await executePlan(mutationContext(replay), { dryRun: false, confirm: true, planHash: hash, operations });
  assert.equal(result.status, "existing");
  assert.equal(result.verified, true);
  assert.equal(result.data?.alreadySatisfiedCount, 1);
  assert.equal(result.data.completedWriteCount, 0);
  assert.equal(result.data.operations[0]?.status, "already_satisfied");
  assert.equal(replay.updateCalls.length, 0);
});

void test("immediate pre-write race stops and skips the untouched remainder", async () => {
  const operations = [update("a", "After A"), update("b", "After B")] as const;
  const hash = await previewHash(operations);
  const raced = gateway("a", "b");
  raced.issueReadQueues.set("a", [snapshot("a"), snapshot("a", "Concurrent", 3)]);
  raced.issueReadQueues.set("b", [snapshot("b")]);
  const result = await executePlan(mutationContext(raced), { dryRun: false, confirm: true, planHash: hash, operations });
  assert.equal(result.status, "conflict");
  assert.equal(result.data?.stoppedAtIndex, 0);
  assert.deepEqual(result.data.operations.map((step) => step.status), ["conflict", "skipped"]);
  assert.equal(raced.updateCalls.length, 0);
  assert.equal(raced.events.filter((event) => event.startsWith("read:b:")).length, 1, "later issue is read only by full preflight");
});

void test("post-read missing and postcondition mismatch fail after exactly one dispatch", async () => {
  const operations = [update("a", "After")] as const;
  const hash = await previewHash(operations);
  for (const [after, kind] of [[null, "post_read_missing"], [snapshot("a", "Wrong", 3), "postcondition_mismatch"]] as const) {
    const value = gateway("a");
    value.issueReadQueues.set("a", [snapshot("a"), snapshot("a"), after]);
    const result = await executePlan(mutationContext(value), { dryRun: false, confirm: true, planHash: hash, operations });
    assert.equal(result.status, "failed");
    assert.equal(result.data?.operations[0]?.error?.kind, kind);
    assert.equal(value.updateCalls.length, 1);
    assert.equal(value.events.filter((event) => event.startsWith("read:a:")).length, 3);
  }
});

void test("uncertain transport is reconciled once when proven and otherwise remains unproven", async () => {
  const operations = [update("a", "After")] as const;
  const hash = await previewHash(operations);
  const timeout = () => new YouTrackHttpError({ kind: "request_timeout", message: "timeout", status: null, retryable: true, requestId: "upstream-write" });
  const reconciled = gateway("a");
  reconciled.issueReadQueues.set("a", [snapshot("a"), snapshot("a"), snapshot("a", "After", 3)]);
  reconciled.writeErrors.push(timeout());
  const success = await executePlan(mutationContext(reconciled), { dryRun: false, confirm: true, planHash: hash, operations });
  assert.equal(success.status, "updated");
  assert.deepEqual(success.warnings.map((warning) => warning.kind), ["write_response_uncertain_reconciled"]);
  assert.equal(reconciled.updateCalls.length, 1);

  const unproven = gateway("a");
  unproven.issueReadQueues.set("a", [snapshot("a"), snapshot("a"), snapshot("a", "Wrong", 3)]);
  unproven.writeErrors.push(timeout());
  const failure = await executePlan(mutationContext(unproven), { dryRun: false, confirm: true, planHash: hash, operations });
  assert.equal(failure.status, "failed");
  assert.equal(failure.data?.operations[0]?.status, "uncertain");
  const error = failure.data.operations[0].error;
  assert.ok(error);
  assert.equal(error.kind, "uncertain_write");
  assert.equal(error.retryable, false);
  assert.equal(unproven.updateCalls.length, 1);
});

void test("partial execution preserves counts, evidence, journal, warning, and skips remainder", async () => {
  const operations = [update("a", "After A"), update("b", "After B"), update("c", "After C")] as const;
  const hash = await previewHash(operations);
  const value = gateway("a", "b", "c");
  value.issueReadQueues.set("a", [snapshot("a"), snapshot("a"), snapshot("a", "After A", 3)]);
  value.issueReadQueues.set("b", [snapshot("b"), snapshot("b", "Concurrent", 3)]);
  value.issueReadQueues.set("c", [snapshot("c")]);
  const result = await executePlan(mutationContext(value), { dryRun: false, confirm: true, planHash: hash, operations });
  assert.equal(result.status, "failed");
  assert.equal(result.error?.kind, "partial_execution");
  assert.equal(result.data?.completedWriteCount, 1);
  assert.equal(result.data.possibleWriteCount, 3);
  assert.equal(result.data.partialCompletion, true);
  assert.equal(result.data.stoppedAtIndex, 1);
  assert.deepEqual(result.data.operations.map((step) => step.status), ["updated", "conflict", "skipped"]);
  assert.deepEqual(result.journal.map((entry) => entry.status), ["completed", "failed", "skipped"]);
  assert.ok(result.warnings.some((warning) => warning.kind === "partial_completion"));
});

void test("tag and link add/remove dispatch their exact primitive once and verify membership", async () => {
  const cases: readonly { operation: PlanOperation; write: string; beforePresent: boolean; afterPresent: boolean }[] = [
    { operation: { kind: "add_tag", issue: { id: "a" }, tag: { id: TAG_A.id }, expectedUpdatedAt: 2 }, write: "write:add-tag", beforePresent: false, afterPresent: true },
    { operation: { kind: "remove_tag", issue: { id: "a" }, tag: { id: TAG_A.id }, expectedUpdatedAt: 2 }, write: "write:remove-tag", beforePresent: true, afterPresent: false },
    { operation: { kind: "add_link", source: { id: "a" }, target: { id: "b" }, linkType: { id: LINK_TYPE_A.id }, direction: "source_to_target", expectedUpdatedAt: 2 }, write: "write:add-link", beforePresent: false, afterPresent: true },
    { operation: { kind: "remove_link", source: { id: "a" }, target: { id: "b" }, linkType: { id: LINK_TYPE_A.id }, direction: "source_to_target", expectedUpdatedAt: 2, expectedExisting: true }, write: "write:remove-link", beforePresent: true, afterPresent: false },
  ];
  for (const item of cases) {
    const previewGateway = gateway("a", "b");
    const executeGateway = gateway("a", "b");
    const isTag = item.operation.kind.endsWith("tag");
    const link = { id: "container-a", type: LINK_TYPE_A, direction: "source_to_target" as const, source: { id: "a", idReadable: "NEUTRAL-a", summary: "A", url: "https://tracker.example.test/a" }, target: { id: "b", idReadable: "NEUTRAL-b", summary: "B", url: "https://tracker.example.test/b" } };
    if (isTag) {
      previewGateway.issueTagsById.set("a", item.beforePresent ? [TAG_A] : []);
      executeGateway.issueTagsById.set("a", item.beforePresent ? [TAG_A] : []);
      executeGateway.mutateOnWrite = () => executeGateway.issueTagsById.set("a", item.afterPresent ? [TAG_A] : []);
    } else {
      previewGateway.issueLinksById.set("a", item.beforePresent ? [link] : []);
      executeGateway.issueLinksById.set("a", item.beforePresent ? [link] : []);
      executeGateway.mutateOnWrite = () => executeGateway.issueLinksById.set("a", item.afterPresent ? [link] : []);
    }
    const hash = await previewHash([item.operation], previewGateway);
    const result = await executePlan(mutationContext(executeGateway), { dryRun: false, confirm: true, planHash: hash, operations: [item.operation] });
    assert.equal(result.status, "updated", item.operation.kind);
    assert.equal(executeGateway.events.filter((event) => event.startsWith(item.write)).length, 1);
  }
});

void test("the exact generated step request ID reaches the gateway and journal", async () => {
  const operations = [update("a", "After")] as const;
  const hash = await previewHash(operations);
  const value = gateway("a");
  value.issueReadQueues.set("a", [snapshot("a"), snapshot("a"), snapshot("a", "After", 3)]);
  const result = await executePlan(mutationContext(value), { dryRun: false, confirm: true, planHash: hash, operations });
  const stepRequestId = result.data?.operations[0]?.requestId;
  assert.ok(stepRequestId);
  assert.equal(value.updateCalls[0]?.requestId, stepRequestId);
  assert.equal(result.journal[0]?.requestId, stepRequestId);
});

void test("a non-uncertain write rejection is not retried and retains its specific error", async () => {
  const operations = [update("a", "After")] as const;
  const hash = await previewHash(operations);
  const value = gateway("a");
  value.issueReadQueues.set("a", [snapshot("a"), snapshot("a"), snapshot("a", "Wrong", 3)]);
  value.writeErrors.push(new YouTrackHttpError({ kind: "upstream_validation", message: "rejected", status: 422, retryable: false, requestId: "write-upstream" }));
  const result = await executePlan(mutationContext(value), { dryRun: false, confirm: true, planHash: hash, operations });
  assert.equal(result.status, "failed");
  assert.equal(result.data?.operations[0]?.error?.kind, "upstream_validation");
  assert.equal(value.updateCalls.length, 1);
  assert.equal(value.events.filter((event) => event.startsWith("read:a:")).length, 3);
});

void test("pre-dispatch permission denial remains forbidden when no write completed", async () => {
  const operations = [update("a", "After")] as const;
  const hash = await previewHash(operations);
  const value = gateway("a");
  value.issueReadQueues.set("a", [snapshot("a"), new YouTrackHttpError({ kind: "permission_denied", message: "forbidden", status: 403, retryable: false, requestId: "read-denied" })]);
  const result = await executePlan(mutationContext(value), { dryRun: false, confirm: true, planHash: hash, operations });
  assert.equal(result.status, "forbidden");
  assert.equal(result.error?.kind, "permission_denied");
  const deniedStep = result.data?.operations[0];
  assert.ok(deniedStep);
  assert.equal(deniedStep.requestId, null);
  const deniedJournal = result.journal[0];
  assert.ok(deniedJournal);
  assert.equal(Object.hasOwn(deniedJournal, "requestId"), false);
  assert.equal(value.updateCalls.length, 0);
});

void test("a verified no-op before a conflict is not partial execution", async () => {
  const operations = [update("a", "After A"), update("b", "After B")] as const;
  const hash = await previewHash(operations);
  const value = gateway("a", "b");
  value.issueReadQueues.set("a", [snapshot("a"), snapshot("a", "After A", 99)]);
  value.issueReadQueues.set("b", [snapshot("b"), snapshot("b", "Concurrent", 3)]);
  const result = await executePlan(mutationContext(value), { dryRun: false, confirm: true, planHash: hash, operations });
  assert.equal(result.status, "conflict");
  assert.equal(result.error?.kind, "updated_at_mismatch");
  assert.equal(result.data?.alreadySatisfiedCount, 1);
  assert.equal(result.data.completedWriteCount, 0);
  assert.equal(result.data.partialCompletion, false);
  assert.deepEqual(result.data.operations.map((step) => step.status), ["already_satisfied", "conflict"]);
});

void test("link cycle is rechecked immediately and link-container resolution fails closed", async () => {
  const operation: PlanOperation = { kind: "add_link", source: { id: "a" }, target: { id: "b" }, linkType: { id: LINK_TYPE_A.id }, direction: "source_to_target", expectedUpdatedAt: 2, preventCycle: true };
  const preview = gateway("a", "b"); preview.relatedIssues = { items: [], hasMore: false };
  const hash = await previewHash([operation], preview);

  const cycle = gateway("a", "b");
  cycle.relatedIssueSlices = [
    { items: [], hasMore: false },
    { items: [{ id: "a", idReadable: "NEUTRAL-a", summary: "A", url: "https://tracker.example.test/a" }], hasMore: false },
  ];
  const raced = await executePlan(mutationContext(cycle), { dryRun: false, confirm: true, planHash: hash, operations: [operation] });
  assert.equal(raced.status, "invalid");
  assert.equal(raced.data?.operations[0]?.error?.kind, "cycle_detected");
  const cycleStep = raced.data.operations[0];
  assert.ok(cycleStep);
  assert.equal(cycleStep.requestId, null);
  const cycleJournal = raced.journal[0];
  assert.ok(cycleJournal);
  assert.equal(Object.hasOwn(cycleJournal, "requestId"), false);
  assert.equal(cycle.addLinkCalls.length, 0);

  const noContainerOperation = { ...operation, preventCycle: false } as const;
  const noContainerHash = await previewHash([noContainerOperation], gateway("a", "b"));
  for (const containers of [[], [
    { id: "one", linkTypeId: LINK_TYPE_A.id, direction: "source_to_target" as const },
    { id: "two", linkTypeId: LINK_TYPE_A.id, direction: "source_to_target" as const },
  ]]) {
    const value = gateway("a", "b"); value.linkContainers = containers;
    const result = await executePlan(mutationContext(value), { dryRun: false, confirm: true, planHash: noContainerHash, operations: [noContainerOperation] });
    assert.equal(result.data?.operations[0]?.error?.kind, containers.length === 0 ? "link_container_not_found" : "link_container_ambiguous");
    const containerStep = result.data.operations[0];
    assert.ok(containerStep);
    assert.equal(containerStep.requestId, null);
    const containerJournal = result.journal[0];
    assert.ok(containerJournal);
    assert.equal(Object.hasOwn(containerJournal, "requestId"), false);
    assert.equal(value.addLinkCalls.length, 0);
  }
});

void test("target_to_source link execution selects the reverse container and verifies the relation", async () => {
  const operation: PlanOperation = { kind: "add_link", source: { id: "a" }, target: { id: "b" }, linkType: { id: LINK_TYPE_A.id }, direction: "target_to_source", expectedUpdatedAt: 2 };
  const hash = await previewHash([operation], gateway("a", "b"));
  const value = gateway("a", "b");
  value.linkContainers = [{ id: "reverse-container", linkTypeId: LINK_TYPE_A.id, direction: "target_to_source" }];
  const relation = { id: "reverse-container", type: LINK_TYPE_A, direction: "target_to_source" as const, source: { id: "b", idReadable: "NEUTRAL-b", summary: "B", url: "https://tracker.example.test/b" }, target: { id: "a", idReadable: "NEUTRAL-a", summary: "A", url: "https://tracker.example.test/a" } };
  value.issueLinksById.set("a", []);
  value.mutateOnWrite = () => value.issueLinksById.set("a", [relation]);
  const result = await executePlan(mutationContext(value), { dryRun: false, confirm: true, planHash: hash, operations: [operation] });
  assert.equal(result.status, "updated");
  assert.ok(result.data);
  const step = result.data.operations[0];
  assert.ok(step);
  const call = value.addLinkCalls[0];
  assert.ok(call);
  assert.equal(call.containerId, "reverse-container");
  assert.equal(call.requestId, step.requestId);
});
