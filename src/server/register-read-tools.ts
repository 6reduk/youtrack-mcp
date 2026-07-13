import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { findUsers } from "../application/reads/find-users.js";
import { getConnectionConfig } from "../application/reads/get-connection-config.js";
import { getIssue } from "../application/reads/get-issue.js";
import { getProject } from "../application/reads/get-project.js";
import { getProjectSchema } from "../application/reads/get-project-schema.js";
import { getServerInfo } from "../application/reads/get-server-info.js";
import { listIssueLinks } from "../application/reads/list-issue-links.js";
import { listIssueTags } from "../application/reads/list-issue-tags.js";
import { listLinkTypes } from "../application/reads/list-link-types.js";
import { listProjects } from "../application/reads/list-projects.js";
import { listSubtasks } from "../application/reads/list-subtasks.js";
import { listTags } from "../application/reads/list-tags.js";
import { searchIssues } from "../application/reads/search-issues.js";
import type { ReadContext } from "../application/ports.js";
import { createPageRequest } from "../domain/identifiers.js";
import type { OperationResult } from "../domain/operation-result.js";
import { presentResult, presentSafeFailure } from "./result-presenter.js";

const projectSelector = z.union([
  z.strictObject({ id: z.string().trim().min(1) }),
  z.strictObject({ shortName: z.string().trim().min(1) }),
]);
const issueSelector = z.union([
  z.strictObject({ id: z.string().trim().min(1) }),
  z.strictObject({ idReadable: z.string().trim().min(1) }),
]);
const userSelector = z.union([
  z.strictObject({ id: z.string().trim().min(1) }),
  z.strictObject({ login: z.string().trim().min(1) }),
  z.strictObject({ email: z.email() }),
]);
const linkTypeSelector = z.union([
  z.strictObject({ id: z.string().trim().min(1) }),
  z.strictObject({ exactName: z.string().trim().min(1) }),
]);
const pageShape = {
  skip: z.number().int().min(0).max(100_000).default(0),
  top: z.number().int().min(1).max(100).default(50),
};
const sections = z.array(z.enum(["system", "description", "customFields", "tags", "links", "users"])).max(6).optional();
const outputSchema = z.looseObject({});
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

function register<T extends z.ZodRawShape>(
  server: McpServer,
  context: ReadContext,
  name: string,
  description: string,
  inputSchema: z.ZodObject<T>,
  run: (input: z.output<z.ZodObject<T>>) => OperationResult<unknown> | Promise<OperationResult<unknown>>,
): void {
  server.registerTool<typeof outputSchema, z.ZodObject<T>>(
    name,
    { description, inputSchema, outputSchema, annotations },
    async (input) => {
    try {
      return presentResult(await run(input));
    } catch (error: unknown) {
      return presentSafeFailure(name, context.ids.nextId(), error);
    }
    },
  );
}

export function registerReadTools(server: McpServer, context: ReadContext): void {
  register(server, context, "youtrack_get_server_info", "Read server and current-user facts.", z.strictObject({}), () => getServerInfo(context));
  register(server, context, "youtrack_get_connection_config", "Read redacted connection configuration.", z.strictObject({}), () => getConnectionConfig(context));
  register(server, context, "youtrack_list_projects", "List visible projects without assuming a default project.", z.strictObject({
    ...pageShape, query: z.string().trim().min(1).max(500).optional(), includeArchived: z.boolean().default(true),
  }), (input) => listProjects(context, { page: createPageRequest(input.skip, input.top), includeArchived: input.includeArchived, ...(input.query === undefined ? {} : { query: input.query }) }));
  register(server, context, "youtrack_get_project", "Resolve one project by exact ID or short name.", z.strictObject({ project: projectSelector }), (input) => getProject(context, input.project));
  register(server, context, "youtrack_get_project_schema", "Discover actual project fields and type metadata.", z.strictObject({
    project: projectSelector, probeIssue: issueSelector.optional(), includeAllowedValues: z.boolean().default(true),
  }), (input) => getProjectSchema(context, { project: input.project, includeAllowedValues: input.includeAllowedValues, ...(input.probeIssue === undefined ? {} : { probeIssue: input.probeIssue }) }));
  register(server, context, "youtrack_get_issue", "Read one normalized issue by exact ID.", z.strictObject({ issue: issueSelector, sections }), (input) => getIssue(context, input.issue, input.sections));
  register(server, context, "youtrack_search_issues", "Search with official YouTrack query syntax.", z.strictObject({
    ...pageShape, query: z.string().min(1).max(4_000), exactSummary: z.string().max(2_000).optional(), sections,
  }), (input) => searchIssues(context, { query: input.query, page: createPageRequest(input.skip, input.top), ...(input.exactSummary === undefined ? {} : { exactSummary: input.exactSummary }), ...(input.sections === undefined ? {} : { sections: input.sections }) }));
  register(server, context, "youtrack_list_issue_links", "List normalized links without semantic inference.", z.strictObject({ issue: issueSelector, ...pageShape }), (input) => listIssueLinks(context, input.issue, createPageRequest(input.skip, input.top)));
  register(server, context, "youtrack_list_issue_tags", "List tags attached to an issue.", z.strictObject({ issue: issueSelector, ...pageShape }), (input) => listIssueTags(context, input.issue, createPageRequest(input.skip, input.top)));
  register(server, context, "youtrack_list_tags", "Discover visible tags; exactName only post-filters candidates.", z.strictObject({
    ...pageShape, exactName: z.string().trim().min(1).max(500).optional(), query: z.string().trim().min(1).max(500).optional(),
  }), (input) => listTags(context, { page: createPageRequest(input.skip, input.top), ...(input.exactName === undefined ? {} : { exactName: input.exactName }), ...(input.query === undefined ? {} : { query: input.query }) }));
  register(server, context, "youtrack_list_link_types", "List actual link types and directions.", z.strictObject(pageShape), (input) => listLinkTypes(context, createPageRequest(input.skip, input.top)));
  register(server, context, "youtrack_list_subtasks", "List caller-declared child relations by exact type and direction.", z.strictObject({
    ...pageShape, parent: issueSelector, linkType: linkTypeSelector, parentToChildDirection: z.enum(["source_to_target", "target_to_source"]),
  }), (input) => listSubtasks(context, { parent: input.parent, linkType: input.linkType, parentToChildDirection: input.parentToChildDirection, page: createPageRequest(input.skip, input.top) }));
  register(server, context, "youtrack_find_users", "Find visible users by exact selector or discovery query.", z.strictObject({
    ...pageShape, selector: userSelector.optional(), query: z.string().trim().min(1).max(500).optional(), includeBanned: z.boolean().default(true),
  }), (input) => findUsers(context, { page: createPageRequest(input.skip, input.top), includeBanned: input.includeBanned, ...(input.selector === undefined ? {} : { selector: input.selector }), ...(input.query === undefined ? {} : { query: input.query }) }));
}
