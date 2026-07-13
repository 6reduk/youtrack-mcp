import assert from "node:assert/strict";
import test from "node:test";
import type { LoggerPort } from "../../src/application/ports.js";
import { SecretValue, type RuntimeConfig } from "../../src/infrastructure/config.js";
import { YouTrackHttpClient } from "../../src/infrastructure/http/youtrack-http-client.js";
import { RestYouTrackGateway } from "../../src/infrastructure/youtrack/gateway.js";
import { ISSUE_DTO } from "./fixtures.js";
import { withHttpServer } from "./http-test-server.js";

const logger: LoggerPort = { error: () => undefined, warn: () => undefined, info: () => undefined, debug: () => undefined };

function gateway(baseUrl: URL): RestYouTrackGateway {
  const config: RuntimeConfig = {
    baseUrl, token: new SecretValue("mutation-contract-secret"), requestTimeoutMs: 1_000,
    logLevel: "error", insecureHttpAllowed: true,
  };
  return new RestYouTrackGateway(new YouTrackHttpClient({ config, logger }), baseUrl);
}

void test("create sends one exact POST body without relation or tag surface", async () => {
  await withHttpServer(() => ({ body: JSON.stringify(ISSUE_DTO) }), async (baseUrl, requests) => {
    const receipt = await gateway(baseUrl).createIssue({
      projectId: "project-x-id", summary: "Synthetic summary", description: "Synthetic body",
      customFields: [{ id: "field-x-id", name: "Arbitrary field", $type: "SingleEnumIssueCustomField", value: { id: "choice-x-id" } }],
    });
    assert.equal(receipt.issueId, "issue-x-id");
    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.ok(request);
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/tracker/api/issues?fields=id%2CidReadable");
    assert.deepEqual(JSON.parse(request.body), {
      project: { id: "project-x-id" }, summary: "Synthetic summary", description: "Synthetic body",
      customFields: [{ id: "field-x-id", name: "Arbitrary field", $type: "SingleEnumIssueCustomField", value: { id: "choice-x-id" } }],
    });
  });
});

void test("update sends one POST and never retries a failing write", async () => {
  await withHttpServer(() => ({ status: 503, body: "{}" }), async (baseUrl, requests) => {
    await assert.rejects(gateway(baseUrl).updateIssue({ idReadable: "PX-17" }, { summary: "Changed" }));
    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.ok(request);
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/tracker/api/issues/PX-17?fields=id%2CidReadable");
    assert.deepEqual(JSON.parse(request.body), { summary: "Changed" });
  });
});
