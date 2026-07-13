import assert from "node:assert/strict";
import { test } from "node:test";

import { createPageRequest } from "../../../src/domain/identifiers.js";
import { findUsers } from "../../../src/application/reads/find-users.js";
import { DomainValidationError } from "../../../src/domain/identifiers.js";
import { FakeGateway, USER_A, createReadContext } from "./fakes.js";

void test("requires an explicit selector or discovery query", async () => {
  await assert.rejects(
    findUsers(createReadContext(), {
      page: createPageRequest(),
      includeBanned: true,
    }),
    DomainValidationError,
  );
});

void test("filters exact user selectors without case folding or first-candidate choice", async () => {
  const gateway = new FakeGateway();
  gateway.users = {
    items: [USER_A, { ...USER_A, id: "user-b-id", login: "Alpha.User" }],
    hasMore: true,
  };
  const result = await findUsers(createReadContext(gateway), {
    selector: { login: USER_A.login },
    query: "user",
    page: createPageRequest(),
    includeBanned: true,
  });

  assert.deepEqual(result.data?.users.map((user) => user.id), [USER_A.id]);
  assert.equal(result.warnings[0]?.kind, "exact_selector_page_local");
  assert.deepEqual(gateway.lastUserListQuery?.selector, { login: USER_A.login });
});
