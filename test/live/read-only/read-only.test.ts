import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntimeConfig } from "../../../src/infrastructure/config.js";
import { RedactingLogger } from "../../../src/infrastructure/logging/redacting-logger.js";
import { createReadContext } from "../../../src/server/create-server.js";
import { createIssue } from "../../../src/application/mutations/create-issue.js";
import { setIssueState } from "../../../src/application/mutations/set-issue-state.js";
import { livePartialSchemaDryRunsEnabled, liveReadEnabled, requireLivePartialSchemaDryRunGate } from "../helpers.js";

void test("opt-in live connection read is read-only", { skip: !liveReadEnabled() }, async () => {
  const config = loadRuntimeConfig();
  const logger = new RedactingLogger({ level: "error", secrets: [config.token.reveal()] });
  const facts = await createReadContext(config, logger).gateway.getServerFacts();
  assert.ok(facts.currentUser.id.length > 0);
  assert.ok(facts.currentUser.login.length > 0);
  assert.equal(facts.baseUrl, config.baseUrl.href);
});

void test("opt-in agile board discovery is read-only", { skip: !liveReadEnabled() }, async () => {
  const config = loadRuntimeConfig();
  const logger = new RedactingLogger({ level: "error", secrets: [config.token.reveal()] });
  const boards = await createReadContext(config, logger).gateway.listAgileBoards({ page: { skip: 0, top: 5 } });
  assert.ok(boards.items.length <= 5);
});

void test("opt-in scoped agile audit reads are read-only", { skip: !liveReadEnabled() || !process.env.YOUTRACK_LIVE_PROJECT || !process.env.YOUTRACK_LIVE_BOARD_ID || !process.env.YOUTRACK_LIVE_ISSUE }, async () => {
  const config = loadRuntimeConfig();
  const logger = new RedactingLogger({ level: "error", secrets: [config.token.reveal()] });
  const gateway = createReadContext(config, logger).gateway;
  const projects = await gateway.findProjects({ shortName: process.env.YOUTRACK_LIVE_PROJECT ?? "" });
  const project = projects[0];
  assert.ok(project);
  const board = await gateway.getAgileBoard(process.env.YOUTRACK_LIVE_BOARD_ID ?? "");
  assert.ok(board);
  await gateway.listSprints({ boardId: board.id, currentSprintId: board.currentSprint?.id ?? null, page: { skip: 0, top: 5 } });
  await gateway.getProjectTeam({ project, page: { skip: 0, top: 5 } });
  await gateway.listIssueActivities({ issue: { idReadable: process.env.YOUTRACK_LIVE_ISSUE ?? "" }, page: { skip: 0, top: 5 }, categories: ["CustomFieldCategory"], fieldNames: [], reverse: true });
});

void test("opt-in partial-schema mutation acceptance remains dry-run only", { skip: !livePartialSchemaDryRunsEnabled() }, async () => {
  const gate = requireLivePartialSchemaDryRunGate();
  const config = loadRuntimeConfig();
  const logger = new RedactingLogger({ level: "error", secrets: [config.token.reveal()] });
  const context = createReadContext(config, logger);
  const projects = await context.gateway.findProjects({ shortName: gate.project });
  const project = projects.find((candidate) => candidate.shortName === gate.project);
  assert.ok(project);
  const schema = await context.gateway.getAdminProjectSchema(project);
  assert.equal(schema.schemaComplete, false);

  const createResult = await createIssue(context, {
    project: { id: project.id }, summary: "Partial schema dry-run acceptance", description: "No issue is created.",
    customFields: [{
      field: { id: gate.stateFieldId }, action: "set",
      value: { kind: "entity", selector: { id: gate.stateValueId } },
    }],
    probeIssue: { idReadable: gate.probeIssue }, dryRun: true,
  });
  assert.equal(createResult.status, "ok");
  assert.equal(createResult.warnings.some((warning) => warning.kind === "schema_partial"), true);

  const stateResult = await setIssueState(context, {
    issue: { idReadable: gate.targetIssue }, field: { id: gate.stateFieldId },
    value: { id: gate.stateValueId }, dryRun: true,
  });
  assert.equal(stateResult.status, "ok");
  assert.equal(stateResult.warnings.some((warning) => warning.kind === "schema_partial"), true);
});
