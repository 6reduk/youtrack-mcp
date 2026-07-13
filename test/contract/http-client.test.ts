import assert from "node:assert/strict";
import test from "node:test";
import type { LoggerPort } from "../../src/application/ports.js";
import { SecretValue, type RuntimeConfig } from "../../src/infrastructure/config.js";
import { YouTrackHttpError } from "../../src/infrastructure/http/error-mapper.js";
import { YouTrackHttpClient } from "../../src/infrastructure/http/youtrack-http-client.js";
import { withHttpServer } from "./http-test-server.js";

const TOKEN = "contract-test-secret";
const logs: unknown[] = [];
const logger: LoggerPort = {
  error: (message, details) => logs.push([message, details]),
  warn: (message, details) => logs.push([message, details]),
  info: (message, details) => logs.push([message, details]),
  debug: (message, details) => logs.push([message, details]),
};

function config(baseUrl: URL): RuntimeConfig {
  return {
    baseUrl,
    token: new SecretValue(TOKEN),
    requestTimeoutMs: 1_000,
    logLevel: "debug",
    insecureHttpAllowed: true,
  };
}

void test("client sends exact relative API request and keeps authorization out of output", async () => {
  logs.length = 0;
  await withHttpServer(
    () => ({ body: JSON.stringify({ ok: true }) }),
    async (baseUrl, requests) => {
      const client = new YouTrackHttpClient({ config: config(baseUrl), logger });
      assert.deepEqual(await client.getJson("issues", { fields: "id", $top: 2 }, "req-1"), { ok: true });
      const request = requests[0];
      assert.ok(request);
      assert.equal(request.method, "GET");
      assert.equal(request.url, "/tracker/api/issues?fields=id&%24top=2");
      assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
      assert.equal(JSON.stringify(logs).includes(TOKEN), false);
    },
  );
});

void test("safe GET honors bounded retry but POST is never replayed", async () => {
  const delays: number[] = [];
  await withHttpServer(
    (_request, index) => index === 0
      ? { status: 429, headers: { "retry-after": "0.01" }, body: "{}" }
      : { body: "[]" },
    async (baseUrl, requests) => {
      const client = new YouTrackHttpClient({
        config: config(baseUrl), logger, sleep: (delay) => { delays.push(delay); return Promise.resolve(); },
      });
      assert.deepEqual(await client.getJson("issues", undefined, "retry-read"), []);
      assert.equal(requests.length, 2);
      assert.deepEqual(delays, [10]);
    },
  );
  await withHttpServer(
    () => ({ status: 503, body: "{}" }),
    async (baseUrl, requests) => {
      const client = new YouTrackHttpClient({ config: config(baseUrl), logger });
      await assert.rejects(client.requestJson({ method: "POST", path: "issues", requestId: "write", body: {} }),
        (error: unknown) => error instanceof YouTrackHttpError && error.kind === "upstream_unavailable");
      assert.equal(requests.length, 1);
    },
  );
});

void test("HTTP statuses, redirects, malformed and oversized bodies map to safe errors", async () => {
  for (const [status, kind] of [[401, "authentication_failed"], [403, "permission_denied"], [404, "upstream_not_found"], [409, "upstream_conflict"], [422, "upstream_validation"]] as const) {
    await withHttpServer(() => ({ status, body: TOKEN }), async (baseUrl) => {
      const client = new YouTrackHttpClient({ config: config(baseUrl), logger });
      await assert.rejects(client.getJson("resource", undefined, `status-${String(status)}`),
        (error: unknown) => error instanceof YouTrackHttpError && error.kind === kind && !error.message.includes(TOKEN));
    });
  }
  await withHttpServer(() => ({ status: 302, headers: { location: "https://evil.example/" } }), async (baseUrl) => {
    const client = new YouTrackHttpClient({ config: config(baseUrl), logger });
    await assert.rejects(client.getJson("resource", undefined, "redirect"),
      (error: unknown) => error instanceof YouTrackHttpError && error.kind === "redirect_rejected");
  });
  await withHttpServer(() => ({ body: "{" }), async (baseUrl) => {
    const client = new YouTrackHttpClient({ config: config(baseUrl), logger });
    await assert.rejects(client.getJson("resource", undefined, "json"),
      (error: unknown) => error instanceof YouTrackHttpError && error.kind === "invalid_json");
  });
  await withHttpServer(() => ({ body: JSON.stringify("123456") }), async (baseUrl) => {
    const client = new YouTrackHttpClient({ config: config(baseUrl), logger, maxResponseBytes: 3 });
    await assert.rejects(client.getJson("resource", undefined, "large"),
      (error: unknown) => error instanceof YouTrackHttpError && error.kind === "response_too_large");
  });
});

void test("transport timeout and unsafe internal paths are rejected", async () => {
  const timeoutFetch = (() => Promise.reject(Object.assign(new Error("hidden"), { name: "TimeoutError" }))) as typeof fetch;
  const client = new YouTrackHttpClient({ config: config(new URL("http://127.0.0.1:1/")), logger, fetch: timeoutFetch });
  await assert.rejects(client.getJson("issues", undefined, "timeout"),
    (error: unknown) => error instanceof YouTrackHttpError && error.kind === "request_timeout");
  await assert.rejects(client.getJson("https://evil.example/", undefined, "origin"),
    (error: unknown) => error instanceof YouTrackHttpError && error.requestId === "origin");
});
