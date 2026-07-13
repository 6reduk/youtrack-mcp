import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ConfigError,
  DEFAULT_REQUEST_TIMEOUT_MS,
  SecretValue,
  inspectConfig,
  loadRuntimeConfig,
} from "../../src/infrastructure/config.js";

const VALID_ENV: NodeJS.ProcessEnv = {
  YOUTRACK_URL: "https://youtrack.example.test/youtrack/api/",
  YOUTRACK_TOKEN: "permanent-secret-value",
};

void test("loads and normalizes the required connection configuration", () => {
  const config = loadRuntimeConfig(VALID_ENV);

  assert.equal(config.baseUrl.href, "https://youtrack.example.test/youtrack/");
  assert.equal(config.token.reveal(), "permanent-secret-value");
  assert.equal(config.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
  assert.equal(config.logLevel, "info");
  assert.equal(config.insecureHttpAllowed, false);
});

void test("secret value redacts JSON, string and inspect representations", () => {
  const secret = new SecretValue("do-not-print");

  assert.equal(secret.toString(), "[REDACTED]");
  assert.equal(JSON.stringify({ secret }), '{"secret":"[REDACTED]"}');
  assert.doesNotMatch(inspectConfig(loadRuntimeConfig(VALID_ENV)), /permanent-secret-value/);
});

void test("allows HTTP only for an explicitly enabled loopback test server", () => {
  const config = loadRuntimeConfig({
    YOUTRACK_URL: "http://127.0.0.1:8080/api",
    YOUTRACK_TOKEN: "test-secret",
    YOUTRACK_ALLOW_INSECURE_HTTP: "true",
  });

  assert.equal(config.baseUrl.href, "http://127.0.0.1:8080/");
  assert.equal(config.insecureHttpAllowed, true);

  assert.throws(
    () =>
      loadRuntimeConfig({
        YOUTRACK_URL: "http://youtrack.example.test",
        YOUTRACK_TOKEN: "test-secret",
        YOUTRACK_ALLOW_INSECURE_HTTP: "true",
      }),
    ConfigError,
  );
});

void test("rejects credentials, query strings, fragments and invalid optional values", () => {
  const invalidUrls = [
    "https://user:password@youtrack.example.test",
    "https://youtrack.example.test?token=secret",
    "https://youtrack.example.test#fragment",
  ];

  for (const url of invalidUrls) {
    assert.throws(
      () => loadRuntimeConfig({ YOUTRACK_URL: url, YOUTRACK_TOKEN: "test-secret" }),
      ConfigError,
    );
  }

  assert.throws(
    () => loadRuntimeConfig({ ...VALID_ENV, YOUTRACK_REQUEST_TIMEOUT_MS: "999" }),
    /between 1000 and 120000/,
  );
  assert.throws(
    () => loadRuntimeConfig({ ...VALID_ENV, YOUTRACK_LOG_LEVEL: "trace" }),
    /must be one of/,
  );
  assert.throws(
    () => loadRuntimeConfig({ ...VALID_ENV, YOUTRACK_ALLOW_INSECURE_HTTP: "yes" }),
    /either true or false/,
  );
});

void test("missing configuration errors name variables but never include secret values", () => {
  assert.throws(() => loadRuntimeConfig({}), /YOUTRACK_URL is required/);
  assert.throws(
    () => loadRuntimeConfig({ YOUTRACK_URL: "https://youtrack.example.test" }),
    /YOUTRACK_TOKEN is required/,
  );
});
