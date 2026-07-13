import assert from "node:assert/strict";
import test from "node:test";
import type { LoggerPort } from "../../src/application/ports.js";
import { SecretValue, type RuntimeConfig } from "../../src/infrastructure/config.js";
import { YouTrackHttpClient } from "../../src/infrastructure/http/youtrack-http-client.js";
import { RestYouTrackGateway } from "../../src/infrastructure/youtrack/gateway.js";
import { withHttpServer } from "./http-test-server.js";

const logger: LoggerPort = { error: () => undefined, warn: () => undefined, info: () => undefined, debug: () => undefined };
function gateway(baseUrl: URL) { const config: RuntimeConfig = { baseUrl, token: new SecretValue("contract-secret"), requestTimeoutMs: 1_000, logLevel: "error", insecureHttpAllowed: true }; return new RestYouTrackGateway(new YouTrackHttpClient({ config, logger }), baseUrl); }

void test("relation mutation paths use observed container IDs and exact target IDs", async () => {
  await withHttpServer(() => ({ body: "null" }), async (baseUrl, requests) => {
    const api = gateway(baseUrl);
    await api.addIssueLink({ id: "source/id" }, "container/id", "target-id");
    await api.removeIssueLink({ id: "source/id" }, "container/id", "target/id");
    assert.deepEqual(requests.map((item) => [item.method, item.url, item.body]), [
      ["POST", "/tracker/api/issues/source%2Fid/links/container%2Fid/issues", JSON.stringify({ id: "target-id" })],
      ["DELETE", "/tracker/api/issues/source%2Fid/links/container%2Fid/issues/target%2Fid", ""],
    ]);
  });
});

void test("tag add/remove/create remain three explicit resources", async () => {
  await withHttpServer((_request, index) => ({ body: index === 2 ? JSON.stringify({ id: "tag-new", name: "New", owner: { id: "owner", login: "owner" } }) : "null" }), async (baseUrl, requests) => {
    const api = gateway(baseUrl);
    await api.addIssueTag({ id: "issue" }, "tag-id");
    await api.removeIssueTag({ id: "issue" }, "tag-id");
    await api.createTag({ name: "New", ownerId: "owner" });
    assert.deepEqual(requests.map((item) => [item.method, item.url]), [
      ["POST", "/tracker/api/issues/issue/tags"], ["DELETE", "/tracker/api/issues/issue/tags/tag-id"], ["POST", "/tracker/api/tags?fields=id%2Cname%2Cowner%28id%2Clogin%2Cname%2CfullName%2Cemail%2Cbanned%29"],
    ]);
    assert.deepEqual(JSON.parse(requests[0]?.body ?? "null"), { id: "tag-id" });
    assert.deepEqual(JSON.parse(requests[2]?.body ?? "null"), { name: "New", owner: { id: "owner" } });
  });
});
