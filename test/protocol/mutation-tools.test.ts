import assert from "node:assert/strict";
import test from "node:test";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ISSUE_DTO, PROJECT_DTO, PROJECT_FIELD_DTO, USER_DTO } from "../contract/fixtures.js";
import { withHttpServer } from "../contract/http-test-server.js";
import { withStdioClient } from "./stdio-harness.js";

const env = (baseUrl: URL) => ({
  YOUTRACK_URL: baseUrl.href,
  YOUTRACK_TOKEN: "protocol-secret",
  YOUTRACK_ALLOW_INSECURE_HTTP: "true",
  YOUTRACK_LOG_LEVEL: "error",
});

const probeIssue = {
  ...ISSUE_DTO,
  customFields: [{
    id: PROJECT_FIELD_DTO.id,
    name: PROJECT_FIELD_DTO.field.name,
    $type: "SingleEnumIssueCustomField",
    value: PROJECT_FIELD_DTO.bundle.values[0],
    projectCustomField: PROJECT_FIELD_DTO,
  }],
};

const TAG_DTO = { id: "tag-x-id", name: "Tag X", owner: USER_DTO };
const LINK_TYPE_DTO = { id: "link-type-x-id", name: "Relates X", sourceToTarget: "relates to", targetToSource: "is related by", directed: true };
const STATE_FIELD_DTO = {
  ...PROJECT_FIELD_DTO,
  id: "project-state-field-id",
  $type: "StateProjectCustomField",
  field: { id: "state-field-id", name: "Workflow state", fieldType: { id: "state[1]", valueType: "state" } },
  bundle: { id: "state-bundle-id", values: [{ id: "state-next-id", name: "Next", $type: "StateBundleElement" }] },
};
const MULTI_FIELD_DTO = {
  ...PROJECT_FIELD_DTO,
  id: "project-multi-field-id",
  $type: "MultiEnumProjectCustomField",
  field: { id: "multi-field-id", name: "Multiple choices", fieldType: { id: "enum[*]", valueType: "enum" } },
  bundle: { id: "multi-bundle-id", values: PROJECT_FIELD_DTO.bundle.values },
};
const TEXT_FIELD_DTO = { ...PROJECT_FIELD_DTO, id: "project-text-field-id", field: { id: "text-field-id", name: "Text X", fieldType: { id: "text", valueType: "string" } }, bundle: undefined };
const INTEGER_FIELD_DTO = { ...PROJECT_FIELD_DTO, id: "project-integer-field-id", field: { id: "integer-field-id", name: "Integer X", fieldType: { id: "integer", valueType: "integer" } }, bundle: undefined };
const DATE_FIELD_DTO = { ...PROJECT_FIELD_DTO, id: "project-date-field-id", field: { id: "date-field-id", name: "Date X", fieldType: { id: "date", valueType: "date" } }, bundle: undefined };
const PERIOD_FIELD_DTO = { ...PROJECT_FIELD_DTO, id: "project-period-field-id", field: { id: "period-field-id", name: "Period X", fieldType: { id: "period", valueType: "period" } }, bundle: undefined };
const USER_FIELD_DTO = {
  ...PROJECT_FIELD_DTO,
  id: "project-user-field-id",
  $type: "SingleUserProjectCustomField",
  field: { id: "user-field-id", name: "Owner X", fieldType: { id: "user[1]", valueType: "user" } },
  bundle: { id: "user-bundle-id", aggregatedUsers: [USER_DTO] },
};

function issueDto(id: string, overrides: Readonly<Record<string, unknown>> = {}) {
  return { ...ISSUE_DTO, id, idReadable: `PX-${id}`, updated: 20, ...overrides };
}

const simpleUpdate = (id = "op-update") => ({
  kind: "update_issue", operationId: id, issue: { id }, expectedUpdatedAt: 20,
  summary: { action: "set", value: `Changed ${id}` },
});

async function callExecutePlan(client: Client, arguments_: Record<string, unknown>) {
  return client.callTool({ name: "youtrack_execute_plan", arguments: arguments_ });
}

function protocolFixtureResponse(url: string) {
  const decoded = decodeURIComponent(url);
  if (decoded.includes("/admin/projects/project-x-id/customFields?")) {
    return { body: JSON.stringify([PROJECT_FIELD_DTO, MULTI_FIELD_DTO, TEXT_FIELD_DTO, INTEGER_FIELD_DTO, DATE_FIELD_DTO, PERIOD_FIELD_DTO, STATE_FIELD_DTO, USER_FIELD_DTO]) };
  }
  if (decoded.includes("/customFields/project-field-x-id/bundle/values?")) return { body: JSON.stringify(PROJECT_FIELD_DTO.bundle.values) };
  if (decoded.includes("/customFields/project-state-field-id/bundle/values?")) return { body: JSON.stringify(STATE_FIELD_DTO.bundle.values) };
  if (decoded.includes("/customFields/project-multi-field-id/bundle/values?")) return { body: JSON.stringify(MULTI_FIELD_DTO.bundle.values) };
  if (decoded.includes("/bundles/user/user-bundle-id/aggregatedUsers?")) return { body: JSON.stringify([USER_DTO]) };
  if (decoded.includes(`/users/${USER_DTO.id}?`)) return { body: JSON.stringify(USER_DTO) };
  if (decoded.includes("/users?")) return { body: JSON.stringify([USER_DTO]) };
  if (decoded.includes("/issueLinkTypes?")) return { body: JSON.stringify([LINK_TYPE_DTO]) };
  if (decoded.includes("/tags?") && !decoded.includes("/issues/")) return { body: JSON.stringify([TAG_DTO]) };
  if (decoded.includes("/issues/op-remove-tag/tags?")) return { body: JSON.stringify([TAG_DTO]) };
  if (/\/issues\/[^/?]+\/tags\?/u.exec(decoded) !== null) return { body: "[]" };
  if (decoded.includes("/issues/op-remove-link/links/container-remove/issues?")) {
    return { body: JSON.stringify([issueDto("target-remove")]) };
  }
  if (decoded.includes("/issues/op-remove-link/links?")) {
    return { body: JSON.stringify([{ id: "container-remove", direction: "OUTWARD", linkType: LINK_TYPE_DTO }]) };
  }
  if (/\/issues\/[^/?]+\/links\/[^/?]+\/issues\?/u.exec(decoded) !== null) return { body: "[]" };
  if (/\/issues\/[^/?]+\/links\?/u.exec(decoded) !== null) return { body: "[]" };
  const issueMatch = /\/issues\/([^/?]+)\?/u.exec(decoded);
  if (issueMatch?.[1] !== undefined) return { body: JSON.stringify(issueDto(issueMatch[1])) };
  return { status: 500, body: "{}" };
}

void test("partial create probe crosses stdio with warnings and GET-only dry-run", async () => {
  await withHttpServer((request) => {
    if (request.url.includes("/admin/projects/project-x-id/customFields?")) return { body: "[]" };
    if (request.url.includes("/admin/projects/project-x-id?")) return { body: JSON.stringify(PROJECT_DTO) };
    if (request.url.includes("/issues/PX-17?")) return { body: JSON.stringify(probeIssue) };
    return { status: 500, body: "{}" };
  }, async (baseUrl, requests) => {
    await withStdioClient(env(baseUrl), async (client) => {
      const result = await client.callTool({
        name: "youtrack_create_issue",
        arguments: {
          project: { id: PROJECT_DTO.id }, summary: "Protocol dry run", description: "No write",
          customFields: [{
            field: { id: PROJECT_FIELD_DTO.id }, action: "set",
            value: { kind: "entity", selector: { id: PROJECT_FIELD_DTO.bundle.values[0]?.id } },
          }],
          probeIssue: { idReadable: ISSUE_DTO.idReadable }, dryRun: true,
        },
      });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      assert.ok(result.structuredContent);
      const text = (result.content as { type: string; text?: string }[])[0];
      assert.ok(text?.text);
      assert.deepEqual(JSON.parse(text.text), result.structuredContent);
      const envelope = result.structuredContent as { status: string; warnings: { kind: string; details?: unknown }[] };
      assert.equal(envelope.status, "ok", JSON.stringify(result.structuredContent));
      assert.deepEqual(envelope.warnings.map((warning) => warning.kind), ["schema_partial", "required_fields_unverified"]);
      assert.deepEqual(envelope.warnings[0]?.details, { source: "probe_issue", probeIssueId: ISSUE_DTO.idReadable });
      assert.equal(requests.length, 3);
      assert.equal(requests.every((request) => request.method === "GET"), true);
    });
  });
});

void test("create probe selector rejects multiple and unknown keys before HTTP", async () => {
  await withHttpServer(() => ({ status: 500, body: "{}" }), async (baseUrl, requests) => {
    await withStdioClient(env(baseUrl), async (client) => {
      for (const invalidProbe of [
        { id: ISSUE_DTO.id, idReadable: ISSUE_DTO.idReadable },
        { idReadable: ISSUE_DTO.idReadable, fuzzy: true },
      ]) {
        const result = await client.callTool({
          name: "youtrack_create_issue",
          arguments: {
            project: { id: PROJECT_DTO.id }, summary: "Rejected", description: "Rejected",
            probeIssue: invalidProbe, dryRun: true,
          },
        });
        assert.equal(result.isError, true);
        assert.equal(result.structuredContent, undefined);
      }
      assert.equal(requests.length, 0);
    });
  });
});

void test("execute plan enforces the preview/confirm phase matrix and explicit dryRun before HTTP", async () => {
  await withHttpServer(() => ({ status: 500, body: "{}" }), async (baseUrl, requests) => {
    await withStdioClient(env(baseUrl), async (client) => {
      const operation = simpleUpdate();
      const invalidInputs = [
        { operations: [operation] },
        { dryRun: true, confirm: true, operations: [operation] },
        { dryRun: true, planHash: "0".repeat(64), operations: [operation] },
        { dryRun: false, operations: [operation] },
        { dryRun: false, confirm: false, planHash: "0".repeat(64), operations: [operation] },
        { dryRun: false, confirm: true, operations: [operation] },
        { dryRun: false, confirm: true, planHash: "A".repeat(64), operations: [operation] },
        { dryRun: false, confirm: true, planHash: "0".repeat(63), operations: [operation] },
      ];
      for (const input of invalidInputs) {
        const result = await callExecutePlan(client, input);
        assert.equal(result.isError, true, JSON.stringify(input));
        assert.equal(result.structuredContent, undefined);
      }
      assert.equal(requests.length, 0);
    });
  });
});

void test("execute plan rejects unknown, multi-key, malformed, and excluded nested variants before HTTP", async () => {
  await withHttpServer(() => ({ status: 500, body: "{}" }), async (baseUrl, requests) => {
    await withStdioClient(env(baseUrl), async (client) => {
      const invalidOperations: Record<string, unknown>[] = [
        { ...simpleUpdate(), extra: true },
        { ...simpleUpdate(), issue: { id: "x", idReadable: "PX-X" } },
        { ...simpleUpdate(), issue: { id: "x", fuzzy: true } },
        { ...simpleUpdate(), summary: { action: "set", value: "x", extra: true } },
        { kind: "set_custom_field", issue: { id: "x" }, expectedUpdatedAt: 20, change: { field: { id: "f", exactName: "F" }, action: "clear" } },
        { kind: "set_custom_field", issue: { id: "x" }, expectedUpdatedAt: 20, change: { field: { id: "f" }, action: "clear", extra: true } },
        { kind: "set_custom_field", issue: { id: "x" }, expectedUpdatedAt: 20, change: { field: { id: "f" }, action: "set", value: { kind: "scalar", value: "x", extra: true } } },
        { kind: "set_custom_field", issue: { id: "x" }, expectedUpdatedAt: 20, change: { field: { id: "f" }, action: "set", value: { kind: "entity", selector: { id: "v", exactName: "V" } } } },
        { kind: "set_custom_field", issue: { id: "x" }, expectedUpdatedAt: 20, change: { field: { id: "f" }, action: "set", value: { kind: "invented", value: "x" } } },
        { kind: "set_assignee", issue: { id: "x" }, expectedUpdatedAt: 20, field: { id: "f" }, action: "set" },
        { kind: "set_assignee", issue: { id: "x" }, expectedUpdatedAt: 20, field: { id: "f" }, action: "clear", user: { id: "u" } },
        { kind: "remove_link", source: { id: "x" }, target: { id: "y" }, expectedUpdatedAt: 20, linkType: { id: "l" }, direction: "source_to_target" },
        { kind: "create_issue", expectedUpdatedAt: 20 },
        { kind: "set_parent", expectedUpdatedAt: 20 },
      ];
      for (const operation of invalidOperations) {
        const result = await callExecutePlan(client, { dryRun: true, operations: [operation] });
        assert.equal(result.isError, true, JSON.stringify(operation));
        assert.equal(result.structuredContent, undefined);
      }
      for (const root of [
        { dryRun: true, operations: [simpleUpdate()], extra: true },
        { dryRun: true, operations: [simpleUpdate()], confirm: false, planHash: "0".repeat(64) },
      ]) {
        assert.equal((await callExecutePlan(client, root)).isError, true);
      }
      assert.equal(requests.length, 0);
    });
  });
});

void test("execute plan accepts all eight bounded variants and mirrors a planned preview envelope", async () => {
  await withHttpServer((request) => protocolFixtureResponse(request.url), async (baseUrl, requests) => {
    await withStdioClient(env(baseUrl), async (client) => {
      const operations = [
        { ...simpleUpdate(), description: { action: "clear" }, customFields: [
          { field: { id: MULTI_FIELD_DTO.id }, action: "set", value: { kind: "multi", values: [{ kind: "entity", selector: { id: "choice-x-id" } }] } },
          { field: { id: TEXT_FIELD_DTO.id }, action: "set", value: { kind: "scalar", value: "safe text" } },
          { field: { id: INTEGER_FIELD_DTO.id }, action: "set", value: { kind: "scalar", value: 7 } },
          { field: { id: DATE_FIELD_DTO.id }, action: "set", value: { kind: "date", epochMillis: 1_784_200_000_000 } },
          { field: { id: PERIOD_FIELD_DTO.id }, action: "set", value: { kind: "period", iso8601: "P1D" } },
        ] },
        { kind: "set_custom_field", operationId: "set-field", issue: { id: "op-field" }, expectedUpdatedAt: 20, change: { field: { id: PROJECT_FIELD_DTO.id }, action: "set", value: { kind: "entity", selector: { id: "choice-x-id" } } } },
        { kind: "set_issue_state", operationId: "set-state", issue: { id: "op-state" }, expectedUpdatedAt: 20, field: { id: STATE_FIELD_DTO.id }, value: { id: "state-next-id" } },
        { kind: "set_assignee", operationId: "set-assignee", issue: { id: "op-assignee" }, expectedUpdatedAt: 20, field: { id: USER_FIELD_DTO.id }, action: "set", user: { email: ` ${USER_DTO.email} ` } },
        { kind: "add_tag", operationId: "add-tag", issue: { id: "op-add-tag" }, expectedUpdatedAt: 20, tag: { id: TAG_DTO.id } },
        { kind: "remove_tag", operationId: "remove-tag", issue: { id: "op-remove-tag" }, expectedUpdatedAt: 20, tag: { exactName: TAG_DTO.name } },
        { kind: "add_link", operationId: "add-link", source: { id: "op-add-link" }, target: { id: "target-add" }, expectedUpdatedAt: 20, linkType: { id: LINK_TYPE_DTO.id }, direction: "source_to_target" },
        { kind: "remove_link", operationId: "remove-link", source: { id: "op-remove-link" }, target: { id: "target-remove" }, expectedUpdatedAt: 20, linkType: { exactName: LINK_TYPE_DTO.name }, direction: "source_to_target", expectedExisting: true },
      ];
      const result = await callExecutePlan(client, { dryRun: true, confirm: false, operations });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      assert.ok(result.structuredContent);
      const text = (result.content as { type: string; text?: string }[])[0];
      assert.ok(text?.text);
      assert.deepEqual(JSON.parse(text.text), result.structuredContent);
      const envelope = result.structuredContent as {
        status: string;
        data: { planVersion: number; planHash: string; resolvedPlan: { operations: { inputKind: string; preventCycle?: boolean }[] }; possibleWriteCount: number; operations: { status: string }[] };
        journal: { status: string }[];
      };
      assert.equal(envelope.status, "ok", JSON.stringify(result.structuredContent));
      assert.match(envelope.data.planHash, /^[0-9a-f]{64}$/u);
      assert.equal(envelope.data.planVersion, 1);
      assert.equal(envelope.data.resolvedPlan.operations.length, 8);
      assert.equal(envelope.data.resolvedPlan.operations.find((operation) => operation.inputKind === "add_link")?.preventCycle, false);
      assert.equal(envelope.data.possibleWriteCount, 8);
      assert.deepEqual(envelope.data.operations.map((step) => step.status), Array.from({ length: 8 }, () => "planned"));
      assert.deepEqual(envelope.journal.map((entry) => entry.status), Array.from({ length: 8 }, () => "planned"));
      assert.equal(requests.every((request) => request.method === "GET"), true);
    });
  });
});

void test("execute plan enforces operation count, operationId, numeric, timestamp, and value bounds", async () => {
  await withHttpServer((request) => protocolFixtureResponse(request.url), async (baseUrl, requests) => {
    await withStdioClient(env(baseUrl), async (client) => {
      assert.equal((await callExecutePlan(client, { dryRun: true, operations: [] })).isError, true);
      assert.equal((await callExecutePlan(client, { dryRun: true, operations: Array.from({ length: 21 }, (_, index) => simpleUpdate(`too-many-${String(index)}`)) })).isError, true);
      for (const operation of [
        { ...simpleUpdate(), operationId: "bad space" },
        { ...simpleUpdate(), operationId: "x".repeat(65) },
        { ...simpleUpdate(), expectedUpdatedAt: -1 },
        { ...simpleUpdate(), expectedUpdatedAt: 1.5 },
        { ...simpleUpdate(), expectedUpdatedAt: Number.MAX_SAFE_INTEGER + 1 },
        { kind: "update_issue", issue: { id: "empty-update" }, expectedUpdatedAt: 20 },
        { ...simpleUpdate(), summary: { action: "set", value: "x".repeat(1_001) } },
        { ...simpleUpdate(), description: { action: "set", value: "x".repeat(100_001) } },
        { ...simpleUpdate(), customFields: Array.from({ length: 101 }, () => ({ field: { id: "f" }, action: "clear" })) },
        { kind: "set_custom_field", issue: { id: "x" }, expectedUpdatedAt: 20, change: { field: { id: "f" }, action: "set", value: { kind: "date", epochMillis: 1.5 } } },
        { kind: "set_custom_field", issue: { id: "x" }, expectedUpdatedAt: 20, change: { field: { id: "f" }, action: "set", value: { kind: "date", epochMillis: Number.MAX_SAFE_INTEGER + 1 } } },
        { kind: "set_custom_field", issue: { id: "x" }, expectedUpdatedAt: 20, change: { field: { id: "f" }, action: "set", value: { kind: "multi", values: Array.from({ length: 101 }, () => ({ kind: "scalar", value: "x" })) } } },
      ]) assert.equal((await callExecutePlan(client, { dryRun: true, operations: [operation] })).isError, true);
      const beforeAccepted = requests.length;
      for (const count of [1, 20]) {
        const result = await callExecutePlan(client, { dryRun: true, operations: Array.from({ length: count }, (_, index) => simpleUpdate(`bounded-${String(count)}-${String(index)}`)) });
        assert.equal(result.isError, undefined);
        assert.equal((result.structuredContent as { status: string }).status, "ok");
      }
      assert.equal(requests.slice(0, beforeAccepted).length, 0);
    });
  });
});

void test("confirmed execute plan rejects a wrong hash without writes", async () => {
  await withHttpServer((request) => protocolFixtureResponse(request.url), async (baseUrl, requests) => {
    await withStdioClient(env(baseUrl), async (client) => {
      const operations = [simpleUpdate("hash-subject")];
      const preview = await callExecutePlan(client, { dryRun: true, operations });
      const hash = ((preview.structuredContent as { data: { planHash: string } }).data.planHash);
      const wrongHash = `${hash.startsWith("0") ? "1" : "0"}${hash.slice(1)}`;
      const before = requests.length;
      const result = await callExecutePlan(client, { dryRun: false, confirm: true, planHash: wrongHash, operations });
      const envelope = result.structuredContent as { status: string; error: { kind: string }; data: { completedWriteCount: number } };
      assert.equal(envelope.status, "conflict");
      assert.equal(envelope.error.kind, "plan_hash_mismatch");
      assert.equal(envelope.data.completedWriteCount, 0);
      assert.equal(requests.slice(before).every((request) => request.method === "GET"), true);
    });
  });
});

void test("confirmed execute plan performs one write, verifies it, and replays without another write", async () => {
  let changed = false;
  await withHttpServer((request) => {
    const decoded = decodeURIComponent(request.url);
    if (request.method === "POST" && decoded.includes("/issues/confirmed-subject?")) {
      changed = true;
      return { body: JSON.stringify({ id: "confirmed-subject", idReadable: "PX-confirmed-subject" }) };
    }
    if (decoded.includes("/issues/confirmed-subject?")) {
      return { body: JSON.stringify(issueDto("confirmed-subject", {
        summary: changed ? "Changed confirmed-subject" : ISSUE_DTO.summary,
        updated: changed ? 21 : 20,
      })) };
    }
    return protocolFixtureResponse(request.url);
  }, async (baseUrl, requests) => {
    await withStdioClient(env(baseUrl), async (client) => {
      const operations = [simpleUpdate("confirmed-subject")];
      const preview = await callExecutePlan(client, { dryRun: true, operations });
      const hash = (preview.structuredContent as { data: { planHash: string } }).data.planHash;
      const executed = await callExecutePlan(client, { dryRun: false, confirm: true, planHash: hash, operations });
      const first = executed.structuredContent as {
        status: string;
        verified: boolean;
        data: { completedWriteCount: number; operations: { status: string; verified: boolean; after: { summary: string } }[] };
      };
      assert.equal(first.status, "updated");
      assert.equal(first.verified, true);
      assert.equal(first.data.completedWriteCount, 1);
      assert.equal(first.data.operations[0]?.status, "updated");
      assert.equal(first.data.operations[0].verified, true);
      assert.equal(first.data.operations[0].after.summary, "Changed confirmed-subject");
      assert.equal(requests.filter((request) => request.method === "POST").length, 1);

      const replay = await callExecutePlan(client, { dryRun: false, confirm: true, planHash: hash, operations });
      const second = replay.structuredContent as {
        status: string;
        data: { completedWriteCount: number; alreadySatisfiedCount: number; operations: { status: string; verified: boolean }[] };
      };
      assert.equal(second.status, "existing");
      assert.equal(second.data.completedWriteCount, 0);
      assert.equal(second.data.alreadySatisfiedCount, 1);
      assert.equal(second.data.operations[0]?.status, "already_satisfied");
      assert.equal(second.data.operations[0].verified, true);
      assert.equal(requests.filter((request) => request.method === "POST").length, 1);
    });
  });
});

void test("confirmed execute plan stops after a verified partial write when the next guard conflicts", async () => {
  let firstChanged = false;
  let secondReads = 0;
  await withHttpServer((request) => {
    const decoded = decodeURIComponent(request.url);
    if (request.method === "POST" && decoded.includes("/issues/partial-first?")) {
      firstChanged = true;
      return { body: JSON.stringify({ id: "partial-first", idReadable: "PX-partial-first" }) };
    }
    if (decoded.includes("/issues/partial-first?")) {
      return { body: JSON.stringify(issueDto("partial-first", {
        summary: firstChanged ? "Changed partial-first" : ISSUE_DTO.summary,
        updated: firstChanged ? 21 : 20,
      })) };
    }
    if (decoded.includes("/issues/partial-second?")) {
      secondReads += 1;
      return { body: JSON.stringify(issueDto("partial-second", { updated: secondReads >= 2 ? 21 : 20 })) };
    }
    return protocolFixtureResponse(request.url);
  }, async (baseUrl, requests) => {
    await withStdioClient(env(baseUrl), async (client) => {
      const operations = [simpleUpdate("partial-first"), simpleUpdate("partial-second")];
      const preview = await callExecutePlan(client, { dryRun: true, operations });
      const hash = (preview.structuredContent as { data: { planHash: string } }).data.planHash;
      firstChanged = false;
      secondReads = 0;
      const result = await callExecutePlan(client, { dryRun: false, confirm: true, planHash: hash, operations });
      const envelope = result.structuredContent as {
        status: string;
        error: { kind: string };
        warnings: { kind: string }[];
        data: { completedWriteCount: number; stoppedAtIndex: number; partialCompletion: boolean; operations: { status: string }[] };
      };
      assert.equal(envelope.status, "failed");
      assert.equal(envelope.error.kind, "partial_execution");
      assert.equal(envelope.data.completedWriteCount, 1);
      assert.equal(envelope.data.stoppedAtIndex, 1);
      assert.equal(envelope.data.partialCompletion, true);
      assert.deepEqual(envelope.data.operations.map((step) => step.status), ["updated", "conflict"]);
      assert.equal(envelope.warnings.some((warning) => warning.kind === "partial_completion"), true);
      assert.equal(requests.filter((request) => request.method === "POST").length, 1);
    });
  });
});
