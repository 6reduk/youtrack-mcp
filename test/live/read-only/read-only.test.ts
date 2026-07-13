import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntimeConfig } from "../../../src/infrastructure/config.js";
import { RedactingLogger } from "../../../src/infrastructure/logging/redacting-logger.js";
import { createReadContext } from "../../../src/server/create-server.js";
import { liveReadEnabled } from "../helpers.js";

void test("opt-in live connection read is read-only", { skip: !liveReadEnabled() }, async () => {
  const config = loadRuntimeConfig();
  const logger = new RedactingLogger({ level: "error", secrets: [config.token.reveal()] });
  const facts = await createReadContext(config, logger).gateway.getServerFacts();
  assert.ok(facts.currentUser.id.length > 0);
  assert.ok(facts.currentUser.login.length > 0);
  assert.equal(facts.baseUrl, config.baseUrl.href);
});
