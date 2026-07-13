import assert from "node:assert/strict";
import { test } from "node:test";

import { verifyPostconditions } from "../../src/domain/verification.js";

interface Snapshot {
  readonly summary: string;
  readonly unrelated: number;
  readonly values: readonly string[];
}

void test("verifies only requested postconditions and ignores unrelated changes", () => {
  const result = verifyPostconditions<Snapshot>(
    { summary: "Expected", unrelated: 999, values: ["a", "b"] },
    [
      { name: "summary", expected: "Expected", observe: (snapshot) => snapshot.summary },
      { name: "values", expected: ["a", "b"], observe: (snapshot) => snapshot.values },
    ],
  );

  assert.deepEqual(result, { verified: true, mismatches: [] });
});

void test("returns each mismatch and supports an explicit equality rule", () => {
  const result = verifyPostconditions<Snapshot>(
    { summary: "actual", unrelated: 0, values: ["b", "a"] },
    [
      { name: "summary", expected: "expected", observe: (snapshot) => snapshot.summary },
      {
        name: "values",
        expected: ["a", "b"],
        observe: (snapshot) => snapshot.values,
        equals: (expected, actual) =>
          [...(expected as readonly string[])].sort().join() ===
          [...(actual as readonly string[])].sort().join(),
      },
    ],
  );

  assert.equal(result.verified, false);
  assert.deepEqual(result.mismatches, [
    { name: "summary", expected: "expected", actual: "actual" },
  ]);
});
