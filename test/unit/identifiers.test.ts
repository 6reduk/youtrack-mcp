import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DomainValidationError,
  createPageRequest,
  createSelector,
  getSelectorEntry,
} from "../../src/domain/identifiers.js";

void test("creates trimmed explicit selectors and exposes the single entry", () => {
  const selector = createSelector<"id" | "exactName">("exactName", "  Exact value  ");
  assert.deepEqual(selector, { exactName: "Exact value" });
  assert.deepEqual(getSelectorEntry(selector, ["id", "exactName"]), {
    key: "exactName",
    value: "Exact value",
  });
});

void test("rejects empty, multi-key and unsupported selector shapes", () => {
  assert.throws(() => createSelector("id", "  "), DomainValidationError);
  assert.throws(
    () =>
      getSelectorEntry({ id: "one", exactName: "two" }, ["id", "exactName"]),
    /exactly one discriminator/,
  );
  assert.throws(
    () =>
      getSelectorEntry(
        { id: "one" } as unknown as { readonly exactName: string },
        ["exactName"] as const,
      ),
    /not supported/,
  );
});

void test("validates bounded paging", () => {
  assert.deepEqual(createPageRequest(), { skip: 0, top: 50 });
  assert.deepEqual(createPageRequest(10, 100), { skip: 10, top: 100 });
  assert.throws(() => createPageRequest(-1, 10));
  assert.throws(() => createPageRequest(0, 101));
  assert.throws(() => createPageRequest(0.5, 10));
});
