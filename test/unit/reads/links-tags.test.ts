import assert from "node:assert/strict";
import { test } from "node:test";

import { createPageRequest } from "../../../src/domain/identifiers.js";
import { listIssueLinks } from "../../../src/application/reads/list-issue-links.js";
import { listIssueTags } from "../../../src/application/reads/list-issue-tags.js";
import { listLinkTypes } from "../../../src/application/reads/list-link-types.js";
import { listSubtasks } from "../../../src/application/reads/list-subtasks.js";
import { listTags } from "../../../src/application/reads/list-tags.js";
import { FakeGateway, ISSUE_A, LINK_TYPE_A, TAG_A, createReadContext } from "./fakes.js";

void test("lists links, issue tags and link types with paging metadata", async () => {
  const context = createReadContext();
  const page = createPageRequest(0, 10);
  const links = await listIssueLinks(context, { id: ISSUE_A.id }, page);
  const tags = await listIssueTags(context, { id: ISSUE_A.id }, page);
  const types = await listLinkTypes(context, page);

  assert.equal(links.status, "ok");
  assert.equal(tags.data?.tags[0]?.id, TAG_A.id);
  assert.equal(types.data?.linkTypes[0]?.id, LINK_TYPE_A.id);
});

void test("exact tag filtering is ordinal and never creates a tag", async () => {
  const gateway = new FakeGateway();
  gateway.tags = {
    items: [TAG_A, { ...TAG_A, id: "tag-b-id", name: "exact tag" }],
    hasMore: true,
  };
  const result = await listTags(createReadContext(gateway), {
    page: createPageRequest(),
    query: "tag",
    exactName: "Exact tag",
  });
  assert.deepEqual(result.data?.tags.map((tag) => tag.id), [TAG_A.id]);
  assert.equal(result.warnings[0]?.kind, "exact_name_page_local");
  assert.equal(gateway.lastTagListQuery?.query, "tag");
});

void test("uses an exact tag name to narrow server candidates when no query is supplied", async () => {
  const gateway = new FakeGateway();
  await listTags(createReadContext(gateway), {
    page: createPageRequest(),
    exactName: TAG_A.name,
  });
  assert.equal(gateway.lastTagListQuery?.query, TAG_A.name);
});

void test("lists caller-declared children using the exact type and direction", async () => {
  const gateway = new FakeGateway();
  const result = await listSubtasks(createReadContext(gateway), {
    parent: { id: ISSUE_A.id },
    linkType: { id: LINK_TYPE_A.id },
    parentToChildDirection: "target_to_source",
    page: createPageRequest(),
  });

  assert.equal(result.status, "ok");
  assert.deepEqual(gateway.lastRelatedQuery, {
    issue: { id: ISSUE_A.id },
    linkType: { id: LINK_TYPE_A.id },
    direction: "target_to_source",
    page: { skip: 0, top: 50 },
  });
});
