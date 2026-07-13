import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createIssue } from "../application/mutations/create-issue.js";
import { setAssignee } from "../application/mutations/set-assignee.js";
import { setCustomField } from "../application/mutations/set-custom-field.js";
import { setIssueState } from "../application/mutations/set-issue-state.js";
import { updateIssue } from "../application/mutations/update-issue.js";
import type { MutationContext } from "../application/ports.js";
import type { OperationResult } from "../domain/operation-result.js";
import { presentResult, presentSafeFailure } from "./result-presenter.js";

const entitySelector = z.union([
  z.strictObject({ id: z.string().trim().min(1) }),
  z.strictObject({ exactName: z.string().trim().min(1) }),
]);
const fieldSelector = entitySelector;
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
const atom = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("scalar"), value: z.union([z.string(), z.number(), z.boolean()]) }),
  z.strictObject({ kind: z.literal("date"), epochMillis: z.number().int() }),
  z.strictObject({ kind: z.literal("period"), iso8601: z.string().regex(/^P(?!$)/) }),
  z.strictObject({ kind: z.literal("entity"), selector: entitySelector }),
  z.strictObject({ kind: z.literal("user"), selector: userSelector }),
]);
const fieldValue = z.union([
  atom,
  z.strictObject({ kind: z.literal("multi"), values: z.array(atom).max(100) }),
]);
const fieldChange = z.union([
  z.strictObject({ field: fieldSelector, action: z.literal("set"), value: fieldValue }),
  z.strictObject({ field: fieldSelector, action: z.literal("clear") }),
]);
const guards = {
  dryRun: z.boolean().default(false),
  expectedUpdatedAt: z.number().int().optional(),
};
const outputSchema = z.looseObject({});

function register<T extends z.ZodRawShape>(
  server: McpServer,
  context: MutationContext,
  name: string,
  inputSchema: z.ZodObject<T>,
  run: (input: z.output<z.ZodObject<T>>) => OperationResult<unknown> | Promise<OperationResult<unknown>>,
  idempotent: boolean,
): void {
  server.registerTool<typeof outputSchema, z.ZodObject<T>>(
    name,
    {
      description: "Perform one explicit, schema-validated YouTrack mutation with read-after-write verification.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: idempotent, openWorldHint: true },
    },
    async (input) => {
      try { return presentResult(await run(input)); }
      catch (error: unknown) { return presentSafeFailure(name, context.ids.nextId(), error); }
    },
  );
}

export function registerMutationTools(server: McpServer, context: MutationContext): void {
  register(server, context, "youtrack_create_issue", z.strictObject({
    project: projectSelector,
    summary: z.string().min(1).max(1_000),
    description: z.string().max(100_000),
    customFields: z.array(fieldChange).max(100).optional(),
    dryRun: z.boolean().default(false),
  }), (input) => createIssue(context, {
    project: input.project, summary: input.summary, description: input.description, dryRun: input.dryRun,
    ...(input.customFields === undefined ? {} : { customFields: input.customFields }),
  }), false);

  register(server, context, "youtrack_update_issue", z.strictObject({
    issue: issueSelector,
    summary: z.strictObject({ action: z.literal("set"), value: z.string().min(1).max(1_000) }).optional(),
    description: z.union([
      z.strictObject({ action: z.literal("set"), value: z.string().max(100_000) }),
      z.strictObject({ action: z.literal("clear") }),
    ]).optional(),
    customFields: z.array(fieldChange).max(100).optional(),
    ...guards,
  }), (input) => updateIssue(context, {
    issue: input.issue, dryRun: input.dryRun,
    ...(input.expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: input.expectedUpdatedAt }),
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.customFields === undefined ? {} : { customFields: input.customFields }),
  }), true);

  register(server, context, "youtrack_set_custom_field", z.strictObject({
    issue: issueSelector, change: fieldChange, ...guards,
  }), (input) => setCustomField(context, {
    issue: input.issue, change: input.change, dryRun: input.dryRun,
    ...(input.expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: input.expectedUpdatedAt }),
  }), true);

  register(server, context, "youtrack_set_issue_state", z.strictObject({
    issue: issueSelector, field: fieldSelector.optional(), value: entitySelector, ...guards,
  }), (input) => setIssueState(context, {
    issue: input.issue, value: input.value, dryRun: input.dryRun,
    ...(input.field === undefined ? {} : { field: input.field }),
    ...(input.expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: input.expectedUpdatedAt }),
  }), true);

  register(server, context, "youtrack_set_assignee", z.strictObject({
    issue: issueSelector, field: fieldSelector.optional(), action: z.enum(["set", "clear"]),
    user: userSelector.optional(), ...guards,
  }).superRefine((value, refinement) => {
    if ((value.action === "set") !== (value.user !== undefined)) {
      refinement.addIssue({ code: "custom", message: "user is required only for action=set" });
    }
  }), (input) => {
    const common = {
      issue: input.issue,
      ...(input.field === undefined ? {} : { field: input.field }),
      dryRun: input.dryRun,
      ...(input.expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: input.expectedUpdatedAt }),
    };
    if (input.action === "clear") return setAssignee(context, { ...common, action: "clear" });
    if (input.user === undefined) throw new Error("validated user missing");
    return setAssignee(context, { ...common, action: "set", user: input.user });
  }, true);
}
