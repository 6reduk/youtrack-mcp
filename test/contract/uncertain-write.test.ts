import assert from "node:assert/strict";
import test from "node:test";
import { updateIssue } from "../../src/application/mutations/update-issue.js";
import type { LoggerPort } from "../../src/application/ports.js";
import { SecretValue, type RuntimeConfig } from "../../src/infrastructure/config.js";
import { YouTrackHttpClient } from "../../src/infrastructure/http/youtrack-http-client.js";
import { RestYouTrackGateway } from "../../src/infrastructure/youtrack/gateway.js";
import { ISSUE_DTO } from "./fixtures.js";
import { createReadContext } from "../unit/reads/fakes.js";

const logger: LoggerPort = { error: () => undefined, warn: () => undefined, info: () => undefined, debug: () => undefined };

void test("timeout after dispatch triggers read-only reconciliation and no POST replay", async () => {
  let writes = 0;
  let reads = 0;
  const fetchImplementation: typeof fetch = (_input, init) => {
    if (init?.method === "POST") {
      writes += 1;
      return Promise.reject(Object.assign(new Error("synthetic timeout"), { name: "TimeoutError" }));
    }
    reads += 1;
    const issue = reads === 1 ? ISSUE_DTO : { ...ISSUE_DTO, summary: "Changed" };
    return Promise.resolve(new Response(JSON.stringify(issue), { status: 200, headers: { "content-type": "application/json" } }));
  };
  const config: RuntimeConfig = {
    baseUrl: new URL("https://tracker.example.test/"), token: new SecretValue("uncertain-contract-secret"),
    requestTimeoutMs: 1_000, logLevel: "error", insecureHttpAllowed: false,
  };
  const gateway = new RestYouTrackGateway(new YouTrackHttpClient({ config, logger, fetch: fetchImplementation }), config.baseUrl);
  const result = await updateIssue(createReadContext(gateway), {
    issue: { id: "issue-x-id" }, summary: { action: "set", value: "Changed" },
  });
  assert.equal(writes, 1);
  assert.equal(reads, 2);
  assert.equal(result.status, "updated");
  assert.equal(result.warnings[0]?.kind, "write_response_uncertain_reconciled");
});
