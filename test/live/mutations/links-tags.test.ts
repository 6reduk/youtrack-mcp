import test from "node:test";
import { liveMutationEnabled, requireLiveMutationGate } from "../helpers.js";
void test("live relation/tag mutation manifest gate", { skip: !liveMutationEnabled() }, () => {
  const gate = requireLiveMutationGate();
  throw new Error(`Live execution intentionally not implemented before exact call-manifest approval for ${gate.project}:${gate.runPrefix}`);
});
