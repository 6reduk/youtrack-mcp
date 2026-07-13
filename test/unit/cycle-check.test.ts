import assert from "node:assert/strict";
import { test } from "node:test";

import { checkReachability, wouldCreateCycle } from "../../src/domain/cycle-check.js";

function graph(edges: Readonly<Record<string, readonly string[]>>) {
  return async (node: string): Promise<readonly string[]> => Promise.resolve(edges[node] ?? []);
}

void test("detects direct, indirect and self reachability", async () => {
  const outgoing = graph({ a: ["b"], b: ["c"], c: [] });
  assert.equal((await checkReachability({ start: "a", target: "b", getOutgoing: outgoing })).status, "reachable");
  assert.equal((await checkReachability({ start: "a", target: "c", getOutgoing: outgoing })).status, "reachable");
  assert.deepEqual(await checkReachability({ start: "a", target: "a", getOutgoing: outgoing }), {
    status: "reachable",
    visited: 0,
  });
});

void test("reports not_reachable for disconnected and already cyclic graphs", async () => {
  const outgoing = graph({ a: ["b"], b: ["a"], c: [] });
  const result = await checkReachability({ start: "a", target: "c", getOutgoing: outgoing });
  assert.equal(result.status, "not_reachable");
  assert.equal(result.visited, 2);
});

void test("checks a proposed edge by traversing target back to source", async () => {
  const outgoing = graph({ a: ["b"], b: ["c"], c: [] });
  assert.equal((await wouldCreateCycle("c", "a", outgoing)).status, "reachable");
  assert.equal((await wouldCreateCycle("a", "c", outgoing)).status, "not_reachable");
});

void test("returns indeterminate at the configured safety bound", async () => {
  const outgoing = graph({ a: ["b"], b: ["c"], c: ["d"] });
  assert.deepEqual(
    await checkReachability({ start: "a", target: "z", getOutgoing: outgoing, maxVisited: 2 }),
    { status: "indeterminate", visited: 2, reason: "node_limit" },
  );
});
