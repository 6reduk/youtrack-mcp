import assert from "node:assert/strict";
import test from "node:test";
import { requireLiveMutationGate } from "../live/helpers.js";
void test("live mutation gate requires flag, exact project, unique prefix and matching approval", () => {
  assert.throws(() => requireLiveMutationGate({}), /YOUTRACK_LIVE_MUTATION_TESTS/);
  const base = { YOUTRACK_LIVE_MUTATION_TESTS: "1", YOUTRACK_LIVE_MUTATION_PROJECT: "SANDBOX", YOUTRACK_LIVE_MUTATION_PREFIX: "mcp-live-20260714-a" };
  assert.throws(() => requireLiveMutationGate(base), /APPROVAL/);
  assert.deepEqual(requireLiveMutationGate({ ...base, YOUTRACK_LIVE_MUTATION_APPROVAL: "SANDBOX:mcp-live-20260714-a" }), { project: "SANDBOX", runPrefix: "mcp-live-20260714-a" });
});
