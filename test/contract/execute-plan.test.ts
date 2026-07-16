import assert from "node:assert/strict";
import test from "node:test";

import { executePlan } from "../../src/application/mutations/execute-plan.js";
import type { PlanOperation } from "../../src/application/mutations/execute-plan-planner.js";
import type { LoggerPort, MutationContext, YouTrackGateway } from "../../src/application/ports.js";
import { SecretValue, type RuntimeConfig } from "../../src/infrastructure/config.js";
import { YouTrackHttpError } from "../../src/infrastructure/http/error-mapper.js";
import { YouTrackHttpClient } from "../../src/infrastructure/http/youtrack-http-client.js";
import { RestYouTrackGateway } from "../../src/infrastructure/youtrack/gateway.js";
import {
  EXECUTE_PLAN_LINK_TYPE_DTO,
  EXECUTE_PLAN_TAG_DTO,
  executePlanIssueDto,
  executePlanLinkContainerDto,
} from "./fixtures.js";
import { type CapturedRequest, type TestResponse, withHttpServer } from "./http-test-server.js";

const logger: LoggerPort = { error: () => undefined, warn: () => undefined, info: () => undefined, debug: () => undefined };

interface ScenarioOptions {
  readonly initialSummaries?: Readonly<Record<string, string>>;
  readonly tagPresent?: boolean;
  readonly linkPresent?: boolean;
  readonly linksIncomplete?: boolean;
  readonly tagsIncomplete?: boolean;
  readonly linkTypesIncomplete?: boolean;
  readonly cycleIncomplete?: boolean;
  readonly failFirstWrite?: boolean;
  readonly ignoreUpdateWrite?: boolean;
}

function pathname(request: CapturedRequest): string {
  return new URL(request.url, "http://fixture.invalid").pathname;
}

function trace(requests: readonly CapturedRequest[]): readonly string[] {
  return requests.map((request) => `${request.method} ${pathname(request)}`);
}

function issueIdFromPath(path: string): string | null {
  return /^\/tracker\/api\/issues\/([^/]+)$/.exec(path)?.[1] ?? null;
}

function scenarioResponder(options: ScenarioOptions = {}) {
  const summaries = new Map(Object.entries(options.initialSummaries ?? { a: "Before A", b: "Before B" }));
  let tagPresent = options.tagPresent ?? false;
  let linkPresent = options.linkPresent ?? false;
  let writeCount = 0;

  return (request: CapturedRequest): TestResponse => {
    const path = pathname(request);
    const method = request.method;
    const issueId = issueIdFromPath(path);

    if (method === "GET" && issueId !== null) {
      return { body: JSON.stringify(executePlanIssueDto(issueId, summaries.get(issueId) ?? `Before ${issueId.toUpperCase()}`)) };
    }
    if (method === "POST" && issueId !== null) {
      writeCount += 1;
      if (options.failFirstWrite === true && writeCount === 1) return { status: 422, body: "{}" };
      const body = JSON.parse(request.body) as { readonly summary?: string };
      if (body.summary !== undefined && options.ignoreUpdateWrite !== true) summaries.set(issueId, body.summary);
      return { body: JSON.stringify({ id: issueId, idReadable: `QP-${issueId}` }) };
    }
    if (method === "GET" && /\/issues\/[^/]+\/tags$/.test(path)) {
      return { body: JSON.stringify(tagPresent ? [EXECUTE_PLAN_TAG_DTO] : []) };
    }
    if (method === "GET" && path === "/tracker/api/tags") {
      const values = options.tagsIncomplete === true
        ? Array.from({ length: 101 }, (_, index) => ({ ...EXECUTE_PLAN_TAG_DTO, id: `other-tag-${String(index)}` }))
        : [EXECUTE_PLAN_TAG_DTO];
      return { body: JSON.stringify(values) };
    }
    if (method === "POST" && /\/issues\/[^/]+\/tags$/.test(path)) {
      tagPresent = true;
      return { body: "null" };
    }
    if (method === "DELETE" && /\/issues\/[^/]+\/tags\/[^/]+$/.test(path)) {
      tagPresent = false;
      return { body: "null" };
    }
    if (method === "GET" && path === "/tracker/api/issueLinkTypes") {
      const values = options.linkTypesIncomplete === true
        ? Array.from({ length: 101 }, (_, index) => ({ ...EXECUTE_PLAN_LINK_TYPE_DTO, id: `other-link-${String(index)}` }))
        : [EXECUTE_PLAN_LINK_TYPE_DTO];
      return { body: JSON.stringify(values) };
    }
    const containerMatch = /^\/tracker\/api\/issues\/([^/]+)\/links$/.exec(path);
    if (method === "GET" && containerMatch !== null) {
      const id = containerMatch[1] ?? "a";
      if (options.cycleIncomplete === true && id === "b") {
        return { body: JSON.stringify([executePlanLinkContainerDto("cycle-container")]) };
      }
      return { body: JSON.stringify([executePlanLinkContainerDto("container-q")]) };
    }
    const relatedMatch = /^\/tracker\/api\/issues\/([^/]+)\/links\/([^/]+)\/issues$/.exec(path);
    if (method === "GET" && relatedMatch !== null) {
      const id = relatedMatch[1] ?? "a";
      if (options.linksIncomplete === true && id === "a") {
        return {
          body: JSON.stringify(Array.from({ length: 100 }, (_, index) =>
            executePlanIssueDto(`related-${String(index)}`, `Related node ${String(index)}`))),
        };
      }
      if (options.cycleIncomplete === true && id === "b") {
        return {
          body: JSON.stringify(Array.from({ length: 100 }, (_, index) =>
            executePlanIssueDto(`cycle-${String(index)}`, `Cycle node ${String(index)}`))),
        };
      }
      return { body: JSON.stringify(linkPresent && id === "a" ? [executePlanIssueDto("b", "Before B")] : []) };
    }
    if (method === "POST" && relatedMatch !== null) {
      linkPresent = true;
      return { body: "null" };
    }
    if (method === "DELETE" && /\/issues\/[^/]+\/links\/[^/]+\/issues\/[^/]+$/.test(path)) {
      linkPresent = false;
      return { body: "null" };
    }
    if (method === "GET" && /\/admin\/projects\/[^/]+\/customFields$/.test(path)) {
      return { body: "[]" };
    }
    throw new Error(`Unexpected fixture request: ${method} ${request.url}`);
  };
}

function gateway(baseUrl: URL): RestYouTrackGateway {
  const config: RuntimeConfig = {
    baseUrl,
    token: new SecretValue("execute-plan-contract-secret"),
    requestTimeoutMs: 1_000,
    logLevel: "error",
    insecureHttpAllowed: true,
  };
  return new RestYouTrackGateway(new YouTrackHttpClient({ config, logger }), baseUrl);
}

function context(api: YouTrackGateway): MutationContext {
  let sequence = 0;
  return {
    gateway: api,
    connectionConfig: { readConnectionConfig: () => ({ baseUrl: "http://fixture.invalid", tokenConfigured: true, projectSelection: "explicit", defaultProject: null, requestTimeoutMs: 1_000, logLevel: "error", insecureHttpAllowed: true }) },
    ids: { nextId: () => `plan-request-${String(++sequence)}` },
    logger,
  };
}

async function previewHash(operations: readonly PlanOperation[], options: ScenarioOptions = {}): Promise<string> {
  return withHttpServer(scenarioResponder(options), async (baseUrl) => {
    const result = await executePlan(context(gateway(baseUrl)), { dryRun: true, operations });
    assert.equal(result.status, "ok", result.error?.kind);
    assert.ok(result.data?.planHash);
    return result.data.planHash;
  });
}

function update(id: string, value: string): PlanOperation {
  return { kind: "update_issue", operationId: `update-${id}`, issue: { id }, expectedUpdatedAt: 20, summary: { action: "set", value } };
}

const addTag: PlanOperation = { kind: "add_tag", operationId: "tag-add", issue: { id: "a" }, tag: { id: EXECUTE_PLAN_TAG_DTO.id }, expectedUpdatedAt: 20 };
const removeTag: PlanOperation = { kind: "remove_tag", operationId: "tag-remove", issue: { id: "a" }, tag: { id: EXECUTE_PLAN_TAG_DTO.id }, expectedUpdatedAt: 20 };
const addLink: PlanOperation = { kind: "add_link", operationId: "link-add", source: { id: "a" }, target: { id: "b" }, linkType: { id: EXECUTE_PLAN_LINK_TYPE_DTO.id }, direction: "source_to_target", expectedUpdatedAt: 20 };
const removeLink: PlanOperation = { kind: "remove_link", operationId: "link-remove", source: { id: "a" }, target: { id: "b" }, linkType: { id: EXECUTE_PLAN_LINK_TYPE_DTO.id }, direction: "source_to_target", expectedUpdatedAt: 20, expectedExisting: true };

void test("execute-plan preview and confirmed hash mismatch are GET-only", async () => {
  const operations = [update("a", "After A"), update("b", "After B")] as const;
  await withHttpServer(scenarioResponder(), async (baseUrl, requests) => {
    const result = await executePlan(context(gateway(baseUrl)), { dryRun: true, operations });
    assert.equal(result.status, "ok");
    assert.ok(requests.length > 0);
    assert.deepEqual(new Set(requests.map((request) => request.method)), new Set(["GET"]));
  });
  await withHttpServer(scenarioResponder(), async (baseUrl, requests) => {
    const result = await executePlan(context(gateway(baseUrl)), { dryRun: false, confirm: true, planHash: "0".repeat(64), operations });
    assert.equal(result.error?.kind, "plan_hash_mismatch");
    assert.deepEqual(new Set(requests.map((request) => request.method)), new Set(["GET"]));
  });
});

void test("confirmed updates complete full preflight then execute read-write-read sequentially", async () => {
  const operations = [update("a", "After A"), update("b", "After B")] as const;
  const hash = await previewHash(operations);
  await withHttpServer(scenarioResponder(), async (baseUrl, requests) => {
    const result = await executePlan(context(gateway(baseUrl)), { dryRun: false, confirm: true, planHash: hash, operations });
    assert.equal(result.status, "updated");
    assert.deepEqual(trace(requests), [
      "GET /tracker/api/issues/a",
      "GET /tracker/api/issues/b",
      "GET /tracker/api/issues/a",
      "POST /tracker/api/issues/a",
      "GET /tracker/api/issues/a",
      "GET /tracker/api/issues/b",
      "POST /tracker/api/issues/b",
      "GET /tracker/api/issues/b",
    ]);
    assert.deepEqual(result.data?.operations.map((step) => step.status), ["updated", "updated"]);
    const writes = requests.filter((request) => request.method === "POST");
    assert.deepEqual(writes.map((request) => request.headers.requestId), result.data.operations.map((step) => step.requestId));
    assert.deepEqual(result.journal.map((entry) => entry.requestId), result.data.operations.map((step) => step.requestId));
  });
});

void test("tag and link add/remove each dispatch exactly once between immediate and reconciliation reads", async () => {
  const cases = [
    { operation: addTag, before: { tagPresent: false }, writeMethod: "POST", writeSuffix: "/tags" },
    { operation: removeTag, before: { tagPresent: true }, writeMethod: "DELETE", writeSuffix: `/tags/${EXECUTE_PLAN_TAG_DTO.id}` },
    { operation: addLink, before: { linkPresent: false }, writeMethod: "POST", writeSuffix: "/links/container-q/issues" },
    { operation: removeLink, before: { linkPresent: true }, writeMethod: "DELETE", writeSuffix: "/links/container-q/issues/b" },
  ] as const;
  for (const item of cases) {
    const hash = await previewHash([item.operation], item.before);
    await withHttpServer(scenarioResponder(item.before), async (baseUrl, requests) => {
      const result = await executePlan(context(gateway(baseUrl)), { dryRun: false, confirm: true, planHash: hash, operations: [item.operation] });
      assert.equal(result.status, "updated", item.operation.kind);
      assert.ok(result.data);
      const writes = requests.filter((request) => request.method === "POST" || request.method === "DELETE");
      assert.equal(writes.length, 1, `${item.operation.kind}: ${trace(requests).join("\n")}`);
      const write = writes[0];
      assert.ok(write);
      assert.equal(write.method, item.writeMethod);
      assert.ok(pathname(write).endsWith(item.writeSuffix));
      const writeIndex = requests.indexOf(write);
      assert.equal(requests[writeIndex - 1]?.method, "GET");
      assert.equal(requests[writeIndex + 1]?.method, "GET");
      assert.equal(write.headers.requestId, result.data.operations[0]?.requestId);
    });
  }
});

void test("timeout after one real POST performs one reconciliation and never replays the write", async () => {
  const operations = [update("a", "After A")] as const;
  const hash = await previewHash(operations);
  await withHttpServer(scenarioResponder(), async (baseUrl, requests) => {
    const real = gateway(baseUrl);
    const uncertain = new Proxy<YouTrackGateway>(real, {
      get(target, property): unknown {
        if (property !== "updateIssue") {
          const member = Reflect.get(target, property, target) as unknown;
          return typeof member === "function" ? (member.bind(target) as unknown) : member;
        }
        return async (...args: Parameters<YouTrackGateway["updateIssue"]>) => {
          await target.updateIssue(...args);
          throw new YouTrackHttpError({ kind: "request_timeout", message: "response lost", status: null, retryable: false, requestId: args[2] ?? "missing" });
        };
      },
    });
    const result = await executePlan(context(uncertain), { dryRun: false, confirm: true, planHash: hash, operations });
    assert.equal(result.status, "updated");
    assert.equal(requests.filter((request) => request.method === "POST").length, 1);
    assert.equal(trace(requests).at(-1), "GET /tracker/api/issues/a");
    assert.equal(requests.filter((request) => pathname(request) === "/tracker/api/issues/a" && request.method === "GET").length, 3);
    assert.ok(result.warnings.some((warning) => warning.kind === "write_response_uncertain_reconciled"));
  });
});

void test("unproven response loss is uncertain, reconciles once, and skips the untouched remainder", async () => {
  const operations = [update("a", "After A"), update("b", "After B")] as const;
  const hash = await previewHash(operations);
  await withHttpServer(scenarioResponder({ ignoreUpdateWrite: true }), async (baseUrl, requests) => {
    const real = gateway(baseUrl);
    const uncertain = new Proxy<YouTrackGateway>(real, {
      get(target, property): unknown {
        if (property !== "updateIssue") {
          const member = Reflect.get(target, property, target) as unknown;
          return typeof member === "function" ? (member.bind(target) as unknown) : member;
        }
        return async (...args: Parameters<YouTrackGateway["updateIssue"]>) => {
          await target.updateIssue(...args);
          throw new YouTrackHttpError({ kind: "request_timeout", message: "response lost", status: null, retryable: false, requestId: args[2] ?? "missing" });
        };
      },
    });
    const result = await executePlan(context(uncertain), { dryRun: false, confirm: true, planHash: hash, operations });
    assert.equal(result.status, "failed");
    assert.ok(result.data);
    assert.deepEqual(result.data.operations.map((step) => step.status), ["uncertain", "skipped"]);
    assert.equal(result.data.operations[0]?.error?.kind, "uncertain_write");
    assert.equal(result.data.operations[0].error.retryable, false);
    assert.deepEqual(trace(requests), [
      "GET /tracker/api/issues/a",
      "GET /tracker/api/issues/b",
      "GET /tracker/api/issues/a",
      "POST /tracker/api/issues/a",
      "GET /tracker/api/issues/a",
    ]);
    assert.equal(requests.filter((request) => request.method === "POST").length, 1);
    assert.equal(requests.filter((request) => request.method === "GET" && pathname(request) === "/tracker/api/issues/a").length, 3);
    assert.equal(requests.filter((request) => request.method === "GET" && pathname(request) === "/tracker/api/issues/b").length, 1);
  });
});

void test("confirmed cycle-protected link repeats traversal and container proof immediately before its sole write", async () => {
  const operation: PlanOperation = { ...addLink, preventCycle: true };
  const hash = await previewHash([operation]);
  await withHttpServer(scenarioResponder(), async (baseUrl, requests) => {
    const result = await executePlan(context(gateway(baseUrl)), { dryRun: false, confirm: true, planHash: hash, operations: [operation] });
    assert.equal(result.status, "updated");
    assert.deepEqual(trace(requests), [
      // Full preflight: source relation evidence, exact target/type, and cycle traversal from target.
      "GET /tracker/api/issues/a",
      "GET /tracker/api/issues/a",
      "GET /tracker/api/issues/a/links",
      "GET /tracker/api/issues/a/links/container-q/issues",
      "GET /tracker/api/issues/b",
      "GET /tracker/api/issueLinkTypes",
      "GET /tracker/api/issues/b",
      "GET /tracker/api/issues/b/links",
      "GET /tracker/api/issues/b/links/container-q/issues",
      // Immediate subject reread, repeated cycle traversal, then exact link-container lookup.
      "GET /tracker/api/issues/a",
      "GET /tracker/api/issues/a",
      "GET /tracker/api/issues/a/links",
      "GET /tracker/api/issues/a/links/container-q/issues",
      "GET /tracker/api/issues/b",
      "GET /tracker/api/issues/b/links",
      "GET /tracker/api/issues/b/links/container-q/issues",
      "GET /tracker/api/issues/a/links",
      "POST /tracker/api/issues/a/links/container-q/issues",
      // Reconciliation snapshot.
      "GET /tracker/api/issues/a",
      "GET /tracker/api/issues/a",
      "GET /tracker/api/issues/a/links",
      "GET /tracker/api/issues/a/links/container-q/issues",
    ]);
    assert.equal(requests.filter((request) => request.method === "POST").length, 1);
    const write = requests.find((request) => request.method === "POST");
    assert.ok(write);
    assert.equal(write.headers.requestId, result.data?.operations[0]?.requestId);
  });
});

void test("first write failure stops the plan and never dispatches a later write", async () => {
  const operations = [update("a", "After A"), update("b", "After B")] as const;
  const hash = await previewHash(operations);
  await withHttpServer(scenarioResponder({ failFirstWrite: true }), async (baseUrl, requests) => {
    const result = await executePlan(context(gateway(baseUrl)), { dryRun: false, confirm: true, planHash: hash, operations });
    assert.equal(result.status, "failed");
    assert.deepEqual(result.data?.operations.map((step) => step.status), ["failed", "skipped"]);
    assert.equal(requests.filter((request) => request.method === "POST").length, 1);
    assert.ok(!requests.some((request) => request.method === "POST" && pathname(request).endsWith("/issues/b")));
    assert.deepEqual(trace(requests), [
      "GET /tracker/api/issues/a",
      "GET /tracker/api/issues/b",
      "GET /tracker/api/issues/a",
      "POST /tracker/api/issues/a",
      "GET /tracker/api/issues/a",
    ]);
    assert.equal(requests.filter((request) => request.method === "GET" && pathname(request) === "/tracker/api/issues/b").length, 1, "later issue is preflight-only");
  });
});

void test("incomplete tag, link-type, schema and cycle evidence all fail before writes", async () => {
  const incompleteCases: readonly { operation: PlanOperation; options: ScenarioOptions; error: string }[] = [
    { operation: addTag, options: { tagsIncomplete: true }, error: "tags_incomplete" },
    { operation: addLink, options: { linksIncomplete: true }, error: "links_incomplete" },
    { operation: addLink, options: { linkTypesIncomplete: true }, error: "link_types_incomplete" },
    {
      operation: { kind: "set_custom_field", issue: { id: "a" }, expectedUpdatedAt: 20, change: { field: { id: "missing-field" }, action: "set", value: { kind: "entity", selector: { id: "missing-value" } } } },
      options: {},
      error: "field_evidence_not_found",
    },
    { operation: { ...addLink, preventCycle: true }, options: { cycleIncomplete: true }, error: "cycle_check_incomplete" },
  ];
  for (const item of incompleteCases) {
    await withHttpServer(scenarioResponder(item.options), async (baseUrl, requests) => {
      const result = await executePlan(context(gateway(baseUrl)), { dryRun: true, operations: [item.operation] });
      assert.equal(result.error?.kind, item.error, `${item.error}: ${trace(requests).join("\n")}`);
      assert.equal(requests.some((request) => request.method === "POST" || request.method === "DELETE"), false);
    });
  }
});
