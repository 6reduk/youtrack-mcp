import assert from "node:assert/strict";
import { test } from "node:test";

import { createPageRequest } from "../../../src/domain/identifiers.js";
import { getIssue } from "../../../src/application/reads/get-issue.js";
import { searchIssues } from "../../../src/application/reads/search-issues.js";
import { FakeGateway, ISSUE_A, createReadContext } from "./fakes.js";

void test("reads an issue with a verification-capable default projection", async () => {
  const gateway = new FakeGateway();
  const result = await getIssue(createReadContext(gateway), { idReadable: ISSUE_A.idReadable });
  assert.equal(result.status, "ok");
  assert.equal(result.target?.idReadable, ISSUE_A.idReadable);
  assert.equal(result.data?.description, "Unchanged markdown");

  gateway.issue = null;
  const missing = await getIssue(createReadContext(gateway), { id: "missing" });
  assert.equal(missing.status, "not_found");
});

void test("keeps official query untouched and exact-filters only the returned page", async () => {
  const gateway = new FakeGateway();
  gateway.issues = {
    items: [ISSUE_A, { ...ISSUE_A, id: "issue-b-id", summary: "exact summary" }],
    hasMore: true,
  };
  const result = await searchIssues(createReadContext(gateway), {
    query: "arbitrary official query",
    exactSummary: "Exact summary",
    page: createPageRequest(0, 20),
  });

  assert.equal(result.data?.issues.length, 1);
  assert.equal(result.data.issues[0]?.id, ISSUE_A.id);
  assert.equal(gateway.lastSearchQuery?.query, "arbitrary official query");
  assert.equal(result.page?.hasMore, true);
  assert.equal(result.warnings[0]?.kind, "exact_summary_page_local");
});
