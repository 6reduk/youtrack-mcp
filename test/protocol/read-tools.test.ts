import assert from "node:assert/strict";
import test from "node:test";
import { withHttpServer } from "../contract/http-test-server.js";
import { PROJECT_DTO } from "../contract/fixtures.js";
import { withStdioClient } from "./stdio-harness.js";

const READ_TOOLS = [
  "youtrack_find_users",
  "youtrack_get_connection_config",
  "youtrack_get_issue",
  "youtrack_get_project",
  "youtrack_get_project_schema",
  "youtrack_get_server_info",
  "youtrack_list_issue_links",
  "youtrack_list_issue_tags",
  "youtrack_list_link_types",
  "youtrack_list_projects",
  "youtrack_list_subtasks",
  "youtrack_list_tags",
  "youtrack_search_issues",
];

const MUTATION_TOOLS = [
  "youtrack_create_issue",
  "youtrack_add_link",
  "youtrack_remove_link",
  "youtrack_set_parent",
  "youtrack_remove_parent",
  "youtrack_add_tag",
  "youtrack_remove_tag",
  "youtrack_create_tag",
  "youtrack_set_assignee",
  "youtrack_set_custom_field",
  "youtrack_set_issue_state",
  "youtrack_update_issue",
];

void test("stdio initialize lists exactly the approved Stage 1-7 tools", async () => {
  await withStdioClient({
    YOUTRACK_URL: "https://tracker.example.test/",
    YOUTRACK_TOKEN: "protocol-secret",
    YOUTRACK_LOG_LEVEL: "error",
  }, async (client) => {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [...READ_TOOLS, ...MUTATION_TOOLS].sort());
    const readTools = tools.tools.filter((tool) => READ_TOOLS.includes(tool.name));
    const mutationTools = tools.tools.filter((tool) => MUTATION_TOOLS.includes(tool.name));
    assert.equal(readTools.every((tool) => tool.annotations?.readOnlyHint === true), true);
    assert.equal(mutationTools.every((tool) => tool.annotations?.destructiveHint === true), true);
  });
});

void test("tool returns identical structuredContent and JSON text envelope", async () => {
  await withStdioClient({
    YOUTRACK_URL: "https://tracker.example.test/",
    YOUTRACK_TOKEN: "protocol-secret",
    YOUTRACK_LOG_LEVEL: "error",
  }, async (client) => {
    const result = await client.callTool({ name: "youtrack_get_connection_config", arguments: {} });
    assert.ok(result.structuredContent);
    assert.ok(Array.isArray(result.content));
    const text = (result.content as { type: string; text?: string }[])[0];
    assert.equal(text?.type, "text");
    assert.ok(text.text);
    assert.deepEqual(JSON.parse(text.text), result.structuredContent);
    const envelope = result.structuredContent as Record<string, unknown>;
    assert.equal((envelope.data as Record<string, unknown>).defaultProject, null);
  });
});

void test("read call crosses stdio and local HTTP with bounded paging", async () => {
  await withHttpServer(() => ({ body: JSON.stringify([PROJECT_DTO]) }), async (baseUrl, requests) => {
    await withStdioClient({
      YOUTRACK_URL: baseUrl.href,
      YOUTRACK_TOKEN: "protocol-secret",
      YOUTRACK_ALLOW_INSECURE_HTTP: "true",
      YOUTRACK_LOG_LEVEL: "error",
    }, async (client) => {
      const result = await client.callTool({
        name: "youtrack_list_projects",
        arguments: { skip: 0, top: 7, includeArchived: true },
      });
      const envelope = result.structuredContent as Record<string, unknown>;
      assert.equal((envelope.data as { projects: unknown[] }).projects.length, 1);
      const url = new URL(requests[0]?.url ?? "", baseUrl);
      assert.equal(url.searchParams.get("$top"), "8");
    });
  });
});

void test("strict input schema rejects unknown keys before a handler call", async () => {
  await withStdioClient({
    YOUTRACK_URL: "https://tracker.example.test/",
    YOUTRACK_TOKEN: "protocol-secret",
    YOUTRACK_LOG_LEVEL: "error",
  }, async (client) => {
    const result = await client.callTool({
      name: "youtrack_get_connection_config",
      arguments: { token: "must-not-be-accepted" },
    });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
  });
});
