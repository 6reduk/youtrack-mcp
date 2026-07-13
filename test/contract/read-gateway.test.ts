import assert from "node:assert/strict";
import test from "node:test";
import type { LoggerPort } from "../../src/application/ports.js";
import { SecretValue, type RuntimeConfig } from "../../src/infrastructure/config.js";
import { YouTrackHttpClient } from "../../src/infrastructure/http/youtrack-http-client.js";
import { RestYouTrackGateway } from "../../src/infrastructure/youtrack/gateway.js";
import { ISSUE_DTO, PROJECT_DTO, USER_DTO } from "./fixtures.js";
import { withHttpServer } from "./http-test-server.js";

const logger: LoggerPort = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

function gateway(baseUrl: URL): RestYouTrackGateway {
  const config: RuntimeConfig = {
    baseUrl,
    token: new SecretValue("gateway-secret"),
    requestTimeoutMs: 1_000,
    logLevel: "error",
    insecureHttpAllowed: true,
  };
  return new RestYouTrackGateway(new YouTrackHttpClient({ config, logger }), baseUrl);
}

void test("gateway uses owned projections and top+1 pagination", async () => {
  await withHttpServer(
    (request) => request.url.includes("/admin/projects?")
      ? { body: JSON.stringify([PROJECT_DTO, { ...PROJECT_DTO, id: "second", shortName: "PY" }]) }
      : { body: JSON.stringify(USER_DTO) },
    async (baseUrl, requests) => {
      const result = await gateway(baseUrl).listProjects({
        page: { skip: 4, top: 1 }, query: "Project", includeArchived: true,
      });
      assert.equal(result.items.length, 1);
      assert.equal(result.hasMore, true);
      const url = new URL(requests[0]?.url ?? "", baseUrl);
      assert.equal(url.pathname, "/tracker/api/admin/projects");
      assert.equal(url.searchParams.get("$skip"), "4");
      assert.equal(url.searchParams.get("$top"), "2");
      assert.match(url.searchParams.get("fields") ?? "", /shortName/);
    },
  );
});

void test("issue mapping is neutral and section reads use explicit endpoints", async () => {
  await withHttpServer(
    (request) => {
      if (request.url.includes("/tags?")) return { body: "[]" };
      if (request.url.includes("/links?")) return { body: "[]" };
      if (request.url.includes("fields=id%2CidReadable%2Csummary")) return { body: JSON.stringify(ISSUE_DTO) };
      return { body: JSON.stringify(ISSUE_DTO) };
    },
    async (baseUrl, requests) => {
      const result = await gateway(baseUrl).getIssue({ idReadable: "PX-17" }, ["system", "tags", "links"]);
      assert.ok(result);
      assert.equal(result.idReadable, "PX-17");
      assert.equal(result.project.shortName, "PX");
      assert.equal(requests.some((request) => request.url.includes("/PX-17/tags?")), true);
      assert.equal(requests.some((request) => request.url.includes("/PX-17/links?")), true);
    },
  );
});

void test("exact user resolution verifies the selected identity", async () => {
  await withHttpServer(() => ({ body: JSON.stringify(USER_DTO) }), async (baseUrl, requests) => {
    const result = await gateway(baseUrl).findUsers({
      selector: { login: "reader.x" }, page: { skip: 0, top: 10 }, includeBanned: false,
    });
    assert.equal(result.items[0]?.login, "reader.x");
    assert.match(requests[0]?.url ?? "", /\/users\/reader\.x\?/);
  });
});
