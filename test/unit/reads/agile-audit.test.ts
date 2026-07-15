import assert from "node:assert/strict";
import test from "node:test";
import { getAgileBoard } from "../../../src/application/reads/get-agile-board.js";
import { getProjectTeam } from "../../../src/application/reads/get-project-team.js";
import { listAgileBoards } from "../../../src/application/reads/list-agile-boards.js";
import { listIssueActivities } from "../../../src/application/reads/list-issue-activities.js";
import { listSprints } from "../../../src/application/reads/list-sprints.js";
import { ISSUE_ACTIVITY_CATEGORIES } from "../../../src/domain/agile-audit.js";
import { BOARD_A, FakeGateway, createReadContext } from "./fakes.js";

void test("agile board reads retain pagination and explicit unavailable fields", async () => {
  const gateway = new FakeGateway();
  const listed = await listAgileBoards(createReadContext(gateway), { skip: 2, top: 7 });
  assert.equal(listed.data?.boards[0]?.archived, null);
  assert.equal(listed.page?.requestedTop, 7);
  assert.equal(listed.warnings[0]?.kind, "upstream_field_unavailable");

  const detailed = await getAgileBoard(createReadContext(gateway), { id: BOARD_A.id });
  assert.equal(detailed.status, "ok");
  assert.ok(detailed.data);
  assert.equal(detailed.data.columnField?.name, "Arbitrary column");
  assert.equal(detailed.data.cardFields, null);
});

void test("duplicate exact board names are ambiguous", async () => {
  const gateway = new FakeGateway();
  gateway.boards = { items: [BOARD_A, { ...BOARD_A, id: "board-b-id" }], hasMore: false };
  const result = await getAgileBoard(createReadContext(gateway), { exactName: BOARD_A.name });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.candidates.length, 2);
});

void test("sprints, team and activities preserve neutral upstream facts", async () => {
  const gateway = new FakeGateway();
  const context = createReadContext(gateway);
  const sprints = await listSprints(context, { exactName: BOARD_A.name }, { skip: 0, top: 10 });
  assert.equal(sprints.data?.sprints[0]?.current, true);

  const team = await getProjectTeam(context, { id: "project-a-id" }, { skip: 0, top: 10 });
  assert.equal(team.data?.users[0]?.membership, "direct");
  assert.ok(team.data);
  const member = team.data.users[0];
  assert.ok(member);
  assert.deepEqual(member.roles, []);

  const activities = await listIssueActivities(context, {
    issue: { idReadable: "ALPHA-1" }, page: { skip: 0, top: 10 }, categories: ISSUE_ACTIVITY_CATEGORIES,
    fieldNames: ["Arbitrary A"], reverse: true,
  });
  assert.equal(activities.data?.activities[0]?.added && typeof activities.data.activities[0].added, "object");
  assert.match(activities.warnings[0]?.message ?? "", /post-filter/);
});
