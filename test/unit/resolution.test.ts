import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveExact } from "../../src/domain/resolution.js";

interface Item {
  readonly id: string;
  readonly name: string;
}

const items: readonly Item[] = [
  { id: "a", name: "Same" },
  { id: "b", name: "Same" },
  { id: "c", name: "same" },
];
const accessors = { id: (item: Item) => item.id, exactName: (item: Item) => item.name };

void test("resolves explicit identifiers exactly", () => {
  const result = resolveExact({ selector: { id: "b" }, candidates: items, accessors });
  assert.deepEqual(result, { status: "resolved", value: items[1] });
});

void test("returns not_found without case folding or fuzzy selection", () => {
  assert.deepEqual(
    resolveExact({ selector: { exactName: "SAME" }, candidates: items, accessors }),
    { status: "not_found" },
  );
});

void test("returns every bounded exact candidate instead of the first", () => {
  const result = resolveExact({
    selector: { exactName: "Same" },
    candidates: items,
    accessors,
    candidateLimit: 10,
  });
  assert.deepEqual(result, {
    status: "ambiguous",
    candidates: items.slice(0, 2),
    totalMatches: 2,
    truncated: false,
  });
});

void test("marks an ambiguous candidate list when the safety bound truncates it", () => {
  const result = resolveExact({
    selector: { exactName: "Same" },
    candidates: items,
    accessors,
    candidateLimit: 1,
  });
  assert.deepEqual(result, {
    status: "ambiguous",
    candidates: items.slice(0, 1),
    totalMatches: 2,
    truncated: true,
  });
});
