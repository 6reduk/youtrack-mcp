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

void test("stdio initialize lists exactly the approved read-only tools", async () => {
  await withStdioClient({
    YOUTRACK_URL: "https://tracker.example.test/",
    YOUTRACK_TOKEN: "protocol-secret",
    YOUTRACK_LOG_LEVEL: "error",
  }, async (client) => {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), READ_TOOLS);
    assert.equal(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true), true);
    assert.equal(tools.tools.some((tool) => /create|update|set_|add_|remove_/.test(tool.name)), false);
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
