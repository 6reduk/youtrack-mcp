import assert from "node:assert/strict";
import test from "node:test";
import type { LoggerPort } from "../../src/application/ports.js";
import { SecretValue, type RuntimeConfig } from "../../src/infrastructure/config.js";
import { YouTrackHttpClient } from "../../src/infrastructure/http/youtrack-http-client.js";
import { RestYouTrackGateway } from "../../src/infrastructure/youtrack/gateway.js";
import { ACTIVITY_DTO, AGILE_DTO, ISSUE_DTO, PROJECT_DTO, SPRINT_DTO, USER_DTO } from "./fixtures.js";
import { withHttpServer } from "./http-test-server.js";

const logger: LoggerPort = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

function gateway(baseUrl: URL): RestYouTrackGateway {
  const config: RuntimeConfig = {
    baseUrl,
    token: new SecretValue("gateway-secret"),
    requestTimeoutMs: 1_000,
    logLevel: "error",
    insecureHttpAllowed: true,
  };
  return new RestYouTrackGateway(new YouTrackHttpClient({ config, logger }), baseUrl);
}

void test("gateway uses owned projections and top+1 pagination", async () => {
  await withHttpServer(
    (request) => request.url.includes("/admin/projects?")
      ? { body: JSON.stringify([PROJECT_DTO, { ...PROJECT_DTO, id: "second", shortName: "PY" }]) }
      : { body: JSON.stringify(USER_DTO) },
    async (baseUrl, requests) => {
      const result = await gateway(baseUrl).listProjects({
        page: { skip: 4, top: 1 }, query: "Project", includeArchived: true,
      });
      assert.equal(result.items.length, 1);
      assert.equal(result.hasMore, true);
      const url = new URL(requests[0]?.url ?? "", baseUrl);
      assert.equal(url.pathname, "/tracker/api/admin/projects");
      assert.equal(url.searchParams.get("$skip"), "4");
      assert.equal(url.searchParams.get("$top"), "2");
      assert.match(url.searchParams.get("fields") ?? "", /shortName/);
    },
  );
});

void test("issue mapping is neutral and section reads use explicit endpoints", async () => {
  await withHttpServer(
    (request) => {
      if (request.url.includes("/tags?")) return { body: "[]" };
      if (request.url.includes("/links?")) return { body: "[]" };
      if (request.url.includes("fields=id%2CidReadable%2Csummary")) return { body: JSON.stringify(ISSUE_DTO) };
      return { body: JSON.stringify(ISSUE_DTO) };
    },
    async (baseUrl, requests) => {
      const result = await gateway(baseUrl).getIssue({ idReadable: "PX-17" }, ["system", "tags", "links"]);
      assert.ok(result);
      assert.equal(result.idReadable, "PX-17");
      assert.equal(result.project.shortName, "PX");
      assert.equal(requests.some((request) => request.url.includes("/PX-17/tags?")), true);
      assert.equal(requests.some((request) => request.url.includes("/PX-17/links?")), true);
    },
  );
});

void test("exact user resolution verifies the selected identity", async () => {
  await withHttpServer(() => ({ body: JSON.stringify(USER_DTO) }), async (baseUrl, requests) => {
    const result = await gateway(baseUrl).findUsers({
      selector: { login: "reader.x" }, page: { skip: 0, top: 10 }, includeBanned: false,
    });
    assert.equal(result.items[0]?.login, "reader.x");
    assert.match(requests[0]?.url ?? "", /\/users\/reader\.x\?/);
  });
});

void test("agile board and sprint reads use documented read-only endpoints", async () => {
  await withHttpServer((request) => {
    if (request.url.includes("/sprints?")) return { body: JSON.stringify([SPRINT_DTO]) };
    if (request.url.includes("/agiles/board-x-id?")) return { body: JSON.stringify(AGILE_DTO) };
    return { body: JSON.stringify([AGILE_DTO]) };
  }, async (baseUrl, requests) => {
    const instance = gateway(baseUrl);
    const boards = await instance.listAgileBoards({ page: { skip: 3, top: 5 } });
    assert.equal(boards.items[0]?.name, "Board X");
    const firstBoard = boards.items[0];
    assert.ok(firstBoard);
    assert.equal(firstBoard.archived, null);
    assert.equal(firstBoard.available, true);
    const details = await instance.getAgileBoard("board-x-id");
    assert.equal(details?.columns[0]?.values[0]?.name, "Queue X");
    const sprints = await instance.listSprints({ boardId: "board-x-id", currentSprintId: "sprint-x-id", page: { skip: 0, top: 5 } });
    assert.equal(sprints.items[0]?.current, true);
    assert.equal(requests.every((request) => request.method === "GET"), true);
    const listUrl = new URL(requests[0]?.url ?? "", baseUrl);
    assert.equal(listUrl.pathname, "/tracker/api/agiles");
    assert.equal(listUrl.searchParams.has("query"), false);
    assert.equal(listUrl.searchParams.get("$top"), "6");
  });
});

void test("project team read maps effective and direct membership without inventing roles", async () => {
  await withHttpServer((request) => {
    if (request.url.includes("/ownUsers?")) return { body: JSON.stringify([{ id: USER_DTO.id }]) };
    if (request.url.includes("/groups?")) return { body: JSON.stringify([{ id: "group-x-id", name: "Group X", usersCount: 4, allUsersGroup: false }]) };
    if (request.url.includes("/assignedRoles?")) return { body: JSON.stringify([{
      id: "assignment-x",
      role: { id: "role-x", name: "Role X", description: null },
      holder: { id: USER_DTO.id },
      scope: { id: "scope-x", $type: "ProjectScope", project: { id: "project-x-id" } },
    }]) };
    if (request.url.includes("/team?")) return { body: JSON.stringify({ id: "team-x-id" }) };
    return { body: JSON.stringify([USER_DTO]) };
  }, async (baseUrl, requests) => {
    const project = { id: "project-x-id", shortName: "PX", name: "Project X", archived: false, url: new URL("projects/PX", baseUrl).href };
    const team = await gateway(baseUrl).getProjectTeam({ project, page: { skip: 0, top: 10 } });
    assert.equal(team.users[0]?.membership, "direct");
    const firstUser = team.users[0];
    assert.ok(firstUser);
    assert.equal(firstUser.roles?.[0]?.name, "Role X");
    assert.equal(team.groups[0]?.name, "Group X");
    assert.equal(team.rolesAvailable, true);
    assert.equal(requests.every((request) => request.method === "GET"), true);
  });
});

void test("project team keeps useful users when optional groups and roles are forbidden", async () => {
  await withHttpServer((request) => {
    if (request.url.includes("/ownUsers?")) return { body: JSON.stringify([{ id: USER_DTO.id }]) };
    if (request.url.includes("/groups?") || request.url.includes("/assignedRoles?")) return { status: 403, body: "{}" };
    if (request.url.includes("/team?")) return { body: JSON.stringify({ id: "team-x-id" }) };
    return { body: JSON.stringify([USER_DTO]) };
  }, async (baseUrl) => {
    const project = { id: "project-x-id", shortName: "PX", name: "Project X", archived: false, url: new URL("projects/PX", baseUrl).href };
    const team = await gateway(baseUrl).getProjectTeam({ project, page: { skip: 0, top: 10 } });
    assert.equal(team.users[0]?.login, USER_DTO.login);
    assert.equal(team.groups.length, 0);
    assert.equal(team.rolesAvailable, false);
    const user = team.users[0];
    assert.ok(user);
    assert.equal(user.roles, null);
    assert.equal(team.warnings.some((warning) => warning.includes("groups are unavailable")), true);
    assert.equal(team.warnings.some((warning) => warning.includes("role assignments")), true);
  });
});

void test("issue activity read sends categories and maps observed changes neutrally", async () => {
  await withHttpServer(() => ({ body: JSON.stringify([ACTIVITY_DTO]) }), async (baseUrl, requests) => {
    const result = await gateway(baseUrl).listIssueActivities({
      issue: { idReadable: "PX-17" }, page: { skip: 2, top: 5 }, categories: ["CustomFieldCategory"], fieldNames: [], reverse: true,
    });
    assert.equal(result.items[0]?.field?.name, "Workflow X");
    const activity = result.items[0];
    assert.ok(activity);
    assert.equal(typeof activity.added, "object");
    const url = new URL(requests[0]?.url ?? "", baseUrl);
    assert.equal(url.pathname, "/tracker/api/issues/PX-17/activities");
    assert.equal(url.searchParams.get("categories"), "CustomFieldCategory");
    assert.equal(url.searchParams.get("reverse"), "true");
    assert.equal(url.searchParams.get("$top"), "6");
  });
});
