import assert from "node:assert/strict";
import test from "node:test";
import type { LoggerPort } from "../../src/application/ports.js";
import { SecretValue, type RuntimeConfig } from "../../src/infrastructure/config.js";
import { YouTrackHttpClient } from "../../src/infrastructure/http/youtrack-http-client.js";
import { RestYouTrackGateway } from "../../src/infrastructure/youtrack/gateway.js";
import { PROJECT_DTO, PROJECT_FIELD_DTO } from "./fixtures.js";
import { withHttpServer } from "./http-test-server.js";

const logger: LoggerPort = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

void test("admin discovery paginates allowed values before claiming completeness", async () => {
  await withHttpServer((request) => request.url.includes("/bundle/values?")
    ? { body: JSON.stringify(PROJECT_FIELD_DTO.bundle.values) }
    : { body: JSON.stringify([PROJECT_FIELD_DTO]) }, async (baseUrl, requests) => {
    const config: RuntimeConfig = {
      baseUrl, token: new SecretValue("schema-secret"), requestTimeoutMs: 1_000,
      logLevel: "error", insecureHttpAllowed: true,
    };
    const gateway = new RestYouTrackGateway(new YouTrackHttpClient({ config, logger }), baseUrl);
    const project = {
      id: PROJECT_DTO.id, shortName: PROJECT_DTO.shortName, name: PROJECT_DTO.name,
      archived: false, url: new URL("projects/PX", baseUrl).href,
    };
    const result = await gateway.getAdminProjectSchema(project);
    assert.equal(result.source.kind, "admin_project_fields");
    assert.equal(result.source.outcome, "ok");
    assert.equal(result.schemaComplete, true);
    const field = result.fields[0];
    assert.ok(field);
    assert.equal(field.name, "Arbitrary phase label");
    assert.equal(field.writability, "unknown");
    assert.equal(field.valuesComplete, true);
    const url = new URL(requests[0]?.url ?? "", baseUrl);
    assert.equal(url.searchParams.get("$top"), "100");
  });
});

void test("forbidden admin schema is an honest non-complete fragment", async () => {
  await withHttpServer(() => ({ status: 403, body: "{}" }), async (baseUrl) => {
    const config: RuntimeConfig = {
      baseUrl, token: new SecretValue("schema-secret"), requestTimeoutMs: 1_000,
      logLevel: "error", insecureHttpAllowed: true,
    };
    const gateway = new RestYouTrackGateway(new YouTrackHttpClient({ config, logger }), baseUrl);
    const result = await gateway.getAdminProjectSchema({
      id: "p", shortName: "P", name: "P", archived: false, url: baseUrl.href,
    });
    assert.deepEqual(result, {
      source: { kind: "admin_project_fields", outcome: "forbidden" },
      schemaComplete: false,
      fields: [],
    });
  });
});
