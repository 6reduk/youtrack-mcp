import assert from "node:assert/strict";
import { test } from "node:test";

import { createPageRequest } from "../../../src/domain/identifiers.js";
import { getConnectionConfig } from "../../../src/application/reads/get-connection-config.js";
import { getProject } from "../../../src/application/reads/get-project.js";
import { getServerInfo } from "../../../src/application/reads/get-server-info.js";
import { listProjects } from "../../../src/application/reads/list-projects.js";
import { FakeGateway, PROJECT_A, createReadContext } from "./fakes.js";

void test("reads server identity and redacted explicit-project connection config", async () => {
  const context = createReadContext();
  const server = await getServerInfo(context);
  const config = getConnectionConfig(context);

  assert.equal(server.status, "ok");
  assert.equal(server.data?.currentUser.login, "alpha.user");
  assert.equal(config.data?.tokenConfigured, true);
  assert.equal(config.data.projectSelection, "explicit");
  assert.equal(config.data.defaultProject, null);
  assert.equal("token" in config.data, false);
});

void test("lists a bounded page and preserves candidate query/default archive behavior", async () => {
  const gateway = new FakeGateway();
  const context = createReadContext(gateway);
  const result = await listProjects(context, { page: createPageRequest(5, 10), query: "Alpha" });

  assert.equal(result.status, "ok");
  assert.deepEqual(result.page, { skip: 5, requestedTop: 10, returned: 1, hasMore: false });
  assert.deepEqual(gateway.lastProjectListQuery, {
    page: { skip: 5, top: 10 },
    query: "Alpha",
    includeArchived: true,
  });
});

void test("gets a project only by exact selector", async () => {
  const context = createReadContext();
  const result = await getProject(context, { shortName: "ALPHA" });
  assert.equal(result.status, "ok");
  assert.equal(result.data?.id, PROJECT_A.id);

  const missing = await getProject(context, { shortName: "alpha" });
  assert.equal(missing.status, "not_found");
});

void test("returns all safe candidates for ambiguous exact projects", async () => {
  const gateway = new FakeGateway();
  gateway.projects = [PROJECT_A, { ...PROJECT_A, id: "project-b-id", name: "Second" }];
  const result = await getProject(createReadContext(gateway), { shortName: "ALPHA" });

  assert.equal(result.status, "ambiguous");
  assert.equal(result.candidates.length, 2);
  assert.equal(result.error?.kind, "project_ambiguous");
});
