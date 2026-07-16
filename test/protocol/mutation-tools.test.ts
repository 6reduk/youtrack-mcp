import assert from "node:assert/strict";
import test from "node:test";
import { ISSUE_DTO, PROJECT_DTO, PROJECT_FIELD_DTO } from "../contract/fixtures.js";
import { withHttpServer } from "../contract/http-test-server.js";
import { withStdioClient } from "./stdio-harness.js";

const env = (baseUrl: URL) => ({
  YOUTRACK_URL: baseUrl.href,
  YOUTRACK_TOKEN: "protocol-secret",
  YOUTRACK_ALLOW_INSECURE_HTTP: "true",
  YOUTRACK_LOG_LEVEL: "error",
});

const probeIssue = {
  ...ISSUE_DTO,
  customFields: [{
    id: PROJECT_FIELD_DTO.id,
    name: PROJECT_FIELD_DTO.field.name,
    $type: "SingleEnumIssueCustomField",
    value: PROJECT_FIELD_DTO.bundle.values[0],
    projectCustomField: PROJECT_FIELD_DTO,
  }],
};

void test("partial create probe crosses stdio with warnings and GET-only dry-run", async () => {
  await withHttpServer((request) => {
    if (request.url.includes("/admin/projects/project-x-id/customFields?")) return { body: "[]" };
    if (request.url.includes("/admin/projects/project-x-id?")) return { body: JSON.stringify(PROJECT_DTO) };
    if (request.url.includes("/issues/PX-17?")) return { body: JSON.stringify(probeIssue) };
    return { status: 500, body: "{}" };
  }, async (baseUrl, requests) => {
    await withStdioClient(env(baseUrl), async (client) => {
      const result = await client.callTool({
        name: "youtrack_create_issue",
        arguments: {
          project: { id: PROJECT_DTO.id }, summary: "Protocol dry run", description: "No write",
          customFields: [{
            field: { id: PROJECT_FIELD_DTO.id }, action: "set",
            value: { kind: "entity", selector: { id: PROJECT_FIELD_DTO.bundle.values[0]?.id } },
          }],
          probeIssue: { idReadable: ISSUE_DTO.idReadable }, dryRun: true,
        },
      });
      assert.equal(result.isError, undefined);
      assert.ok(result.structuredContent);
      const text = (result.content as { type: string; text?: string }[])[0];
      assert.ok(text?.text);
      assert.deepEqual(JSON.parse(text.text), result.structuredContent);
      const envelope = result.structuredContent as { status: string; warnings: { kind: string; details?: unknown }[] };
      assert.equal(envelope.status, "ok");
      assert.deepEqual(envelope.warnings.map((warning) => warning.kind), ["schema_partial", "required_fields_unverified"]);
      assert.deepEqual(envelope.warnings[0]?.details, { source: "probe_issue", probeIssueId: ISSUE_DTO.idReadable });
      assert.equal(requests.length, 3);
      assert.equal(requests.every((request) => request.method === "GET"), true);
    });
  });
});

void test("create probe selector rejects multiple and unknown keys before HTTP", async () => {
  await withHttpServer(() => ({ status: 500, body: "{}" }), async (baseUrl, requests) => {
    await withStdioClient(env(baseUrl), async (client) => {
      for (const invalidProbe of [
        { id: ISSUE_DTO.id, idReadable: ISSUE_DTO.idReadable },
        { idReadable: ISSUE_DTO.idReadable, fuzzy: true },
      ]) {
        const result = await client.callTool({
          name: "youtrack_create_issue",
          arguments: {
            project: { id: PROJECT_DTO.id }, summary: "Rejected", description: "Rejected",
            probeIssue: invalidProbe, dryRun: true,
          },
        });
        assert.equal(result.isError, true);
        assert.equal(result.structuredContent, undefined);
      }
      assert.equal(requests.length, 0);
    });
  });
});
