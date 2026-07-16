import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createIssue } from "../application/mutations/create-issue.js";
import { executePlan } from "../application/mutations/execute-plan.js";
import type { PlanOperation } from "../application/mutations/execute-plan-planner.js";
import { setAssignee } from "../application/mutations/set-assignee.js";
import { setCustomField } from "../application/mutations/set-custom-field.js";
import { setIssueState } from "../application/mutations/set-issue-state.js";
import { updateIssue } from "../application/mutations/update-issue.js";
import { addLink, removeLink } from "../application/mutations/links.js";
import { setParent, removeParent } from "../application/mutations/hierarchy.js";
import { addTag, removeTag, createTag } from "../application/mutations/tags.js";
import type { MutationContext } from "../application/ports.js";
import {
  EXECUTE_PLAN_MAX_CUSTOM_FIELD_CHANGES,
  EXECUTE_PLAN_MAX_MULTI_VALUES,
  EXECUTE_PLAN_MAX_OPERATION_ID_LENGTH,
  EXECUTE_PLAN_MAX_OPERATIONS,
} from "../domain/execute-plan.js";
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
  z.strictObject({ email: z.string().trim().pipe(z.email()).meta({ format: "email" }) }),
]);
const tagSelector = entitySelector;
const linkTypeSelector = entitySelector;
const linkDirection = z.enum(["source_to_target", "target_to_source"]);
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

const executePlanOperationBase = {
  operationId: z.string().min(1).max(EXECUTE_PLAN_MAX_OPERATION_ID_LENGTH).regex(/^[A-Za-z0-9._:-]+$/).optional(),
  expectedUpdatedAt: z.number().int().nonnegative(),
};
const executePlanAtom = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("scalar"),
    value: z.union([z.string(), z.number(), z.boolean()]),
  }),
  z.strictObject({ kind: z.literal("date"), epochMillis: z.number().int() }),
  z.strictObject({ kind: z.literal("period"), iso8601: z.string().regex(/^P(?!$)/) }),
  z.strictObject({ kind: z.literal("entity"), selector: entitySelector }),
  z.strictObject({ kind: z.literal("user"), selector: userSelector }),
]);
const executePlanFieldValue = z.union([
  executePlanAtom,
  z.strictObject({
    kind: z.literal("multi"),
    values: z.array(executePlanAtom).max(EXECUTE_PLAN_MAX_MULTI_VALUES),
  }),
]);
const executePlanFieldChange = z.discriminatedUnion("action", [
  z.strictObject({ field: fieldSelector, action: z.literal("set"), value: executePlanFieldValue }),
  z.strictObject({ field: fieldSelector, action: z.literal("clear") }),
]);
const executePlanUpdateOperation = z.strictObject({
  kind: z.literal("update_issue"),
  ...executePlanOperationBase,
  issue: issueSelector,
  summary: z.strictObject({ action: z.literal("set"), value: z.string().min(1).max(1_000) }).optional(),
  description: z.union([
    z.strictObject({ action: z.literal("set"), value: z.string().max(100_000) }),
    z.strictObject({ action: z.literal("clear") }),
  ]).optional(),
  customFields: z.array(executePlanFieldChange).max(EXECUTE_PLAN_MAX_CUSTOM_FIELD_CHANGES).optional(),
}).superRefine((value, refinement) => {
  if (value.summary === undefined && value.description === undefined && (value.customFields?.length ?? 0) === 0) {
    refinement.addIssue({
      code: "custom",
      message: "at least one of summary, description, or a non-empty customFields array is required",
    });
  }
}).meta({
  anyOf: [
    { required: ["summary"] },
    { required: ["description"] },
    { required: ["customFields"], properties: { customFields: { minItems: 1 } } },
  ],
});
const executePlanSetAssigneeOperation = z.strictObject({
  kind: z.literal("set_assignee"),
  ...executePlanOperationBase,
  issue: issueSelector,
  field: fieldSelector,
  action: z.enum(["set", "clear"]),
  user: userSelector.optional(),
}).superRefine((value, refinement) => {
  if ((value.action === "set") !== (value.user !== undefined)) {
    refinement.addIssue({ code: "custom", message: "user is required only for action=set" });
  }
}).meta({
  oneOf: [
    { required: ["user"], properties: { action: { const: "set" } } },
    { not: { required: ["user"] }, properties: { action: { const: "clear" } } },
  ],
});
const executePlanOperation = z.discriminatedUnion("kind", [
  executePlanUpdateOperation,
  z.strictObject({
    kind: z.literal("set_custom_field"),
    ...executePlanOperationBase,
    issue: issueSelector,
    change: executePlanFieldChange,
  }),
  z.strictObject({
    kind: z.literal("set_issue_state"),
    ...executePlanOperationBase,
    issue: issueSelector,
    field: fieldSelector,
    value: entitySelector,
  }),
  executePlanSetAssigneeOperation,
  z.strictObject({
    kind: z.literal("add_tag"),
    ...executePlanOperationBase,
    issue: issueSelector,
    tag: tagSelector,
  }),
  z.strictObject({
    kind: z.literal("remove_tag"),
    ...executePlanOperationBase,
    issue: issueSelector,
    tag: tagSelector,
  }),
  z.strictObject({
    kind: z.literal("add_link"),
    ...executePlanOperationBase,
    source: issueSelector,
    target: issueSelector,
    linkType: linkTypeSelector,
    direction: linkDirection,
    preventCycle: z.boolean().default(false),
  }),
  z.strictObject({
    kind: z.literal("remove_link"),
    ...executePlanOperationBase,
    source: issueSelector,
    target: issueSelector,
    linkType: linkTypeSelector,
    direction: linkDirection,
    expectedExisting: z.literal(true),
  }),
]);
// SDK 1.29 normalizes only object-root tool schemas for tools/list; passing a root
// discriminatedUnion advertises an empty schema. Keep the root object strict and
// enforce the same exclusive preview/confirmation states with refinements instead.
const executePlanInputSchema = z.strictObject({
  dryRun: z.boolean(),
  confirm: z.boolean().optional(),
  planHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  operations: z.array(executePlanOperation).min(1).max(EXECUTE_PLAN_MAX_OPERATIONS),
}).superRefine((value, refinement) => {
  if (value.dryRun) {
    if (value.confirm === true) {
      refinement.addIssue({ code: "custom", path: ["confirm"], message: "confirm must be false or omitted in preview mode" });
    }
    if (value.planHash !== undefined) {
      refinement.addIssue({ code: "custom", path: ["planHash"], message: "planHash is forbidden in preview mode" });
    }
    return;
  }
  if (value.confirm !== true) {
    refinement.addIssue({ code: "custom", path: ["confirm"], message: "confirm=true is required in confirmed mode" });
  }
  if (value.planHash === undefined) {
    refinement.addIssue({ code: "custom", path: ["planHash"], message: "planHash is required in confirmed mode" });
  }
}).meta({
  oneOf: [
    {
      properties: { dryRun: { const: true }, confirm: { const: false } },
      not: { required: ["planHash"] },
    },
    {
      properties: { dryRun: { const: false }, confirm: { const: true } },
      required: ["confirm", "planHash"],
    },
  ],
});

function normalizeExecutePlanOperations(
  operations: z.output<typeof executePlanInputSchema>["operations"],
): readonly PlanOperation[] {
  return operations.map((operation): PlanOperation => {
    const common = {
      expectedUpdatedAt: operation.expectedUpdatedAt,
      ...(operation.operationId === undefined ? {} : { operationId: operation.operationId }),
    } as const;
    switch (operation.kind) {
      case "update_issue":
        return {
          ...common,
          kind: operation.kind,
          issue: operation.issue,
          ...(operation.summary === undefined ? {} : { summary: operation.summary }),
          ...(operation.description === undefined ? {} : { description: operation.description }),
          ...(operation.customFields === undefined ? {} : { customFields: operation.customFields }),
        };
      case "set_custom_field":
        return { ...common, kind: operation.kind, issue: operation.issue, change: operation.change };
      case "set_issue_state":
        return {
          ...common,
          kind: operation.kind,
          issue: operation.issue,
          field: operation.field,
          value: operation.value,
        };
      case "set_assignee": {
        const assigneeCommon = {
          ...common,
          kind: operation.kind,
          issue: operation.issue,
          field: operation.field,
        } as const;
        if (operation.action === "clear") return { ...assigneeCommon, action: "clear" };
        if (operation.user === undefined) throw new Error("validated user missing");
        return { ...assigneeCommon, action: "set", user: operation.user };
      }
      case "add_tag":
      case "remove_tag":
        return { ...common, kind: operation.kind, issue: operation.issue, tag: operation.tag };
      case "add_link":
        return {
          ...common,
          kind: operation.kind,
          source: operation.source,
          target: operation.target,
          linkType: operation.linkType,
          direction: operation.direction,
          preventCycle: operation.preventCycle,
        };
      case "remove_link":
        return {
          ...common,
          kind: operation.kind,
          source: operation.source,
          target: operation.target,
          linkType: operation.linkType,
          direction: operation.direction,
          expectedExisting: true,
        };
    }
  });
}

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
  server.registerTool<typeof outputSchema, typeof executePlanInputSchema>(
    "youtrack_execute_plan",
    {
      description: "Preview or sequentially execute a bounded, confirmed YouTrack mutation plan. Preview is read-only; confirmed execution is destructive, idempotent by desired state, and non-transactional.",
      inputSchema: executePlanInputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const operations = normalizeExecutePlanOperations(input.operations);
        let result: Awaited<ReturnType<typeof executePlan>>;
        if (input.dryRun) {
          result = await executePlan(context, { dryRun: true, operations });
        } else {
          if (input.confirm !== true || input.planHash === undefined) {
            throw new Error("validated confirmation fields missing");
          }
          result = await executePlan(context, {
            dryRun: false,
            confirm: true,
            planHash: input.planHash,
            operations,
          });
        }
        return presentResult(result);
      } catch (error: unknown) {
        return presentSafeFailure("youtrack_execute_plan", context.ids.nextId(), error);
      }
    },
  );

  register(server, context, "youtrack_create_issue", z.strictObject({
    project: projectSelector,
    summary: z.string().min(1).max(1_000),
    description: z.string().max(100_000),
    customFields: z.array(fieldChange).max(100).optional(),
    probeIssue: issueSelector.optional(),
    dryRun: z.boolean().default(false),
  }), (input) => createIssue(context, {
    project: input.project, summary: input.summary, description: input.description, dryRun: input.dryRun,
    ...(input.customFields === undefined ? {} : { customFields: input.customFields }),
    ...(input.probeIssue === undefined ? {} : { probeIssue: input.probeIssue }),
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

  register(server, context, "youtrack_add_link", z.strictObject({ source: issueSelector, target: issueSelector, linkType: linkTypeSelector, direction: linkDirection, preventCycle: z.boolean().default(false), ...guards }), (input) => addLink(context, input), true);
  register(server, context, "youtrack_remove_link", z.strictObject({ source: issueSelector, target: issueSelector, linkType: linkTypeSelector, direction: linkDirection, expectedExisting: z.literal(true), ...guards }), (input) => removeLink(context, input), true);
  register(server, context, "youtrack_set_parent", z.strictObject({ child: issueSelector, parent: issueSelector, linkType: linkTypeSelector, parentToChildDirection: linkDirection, preventCycle: z.boolean().default(true), replaceExisting: z.boolean().default(false), expectedCurrentParent: issueSelector.optional(), ...guards }), (input) => setParent(context, input), true);
  register(server, context, "youtrack_remove_parent", z.strictObject({ child: issueSelector, expectedParent: issueSelector, linkType: linkTypeSelector, parentToChildDirection: linkDirection, ...guards }), (input) => removeParent(context, input), true);
  register(server, context, "youtrack_add_tag", z.strictObject({ issue: issueSelector, tag: tagSelector, ...guards }), (input) => addTag(context, input), true);
  register(server, context, "youtrack_remove_tag", z.strictObject({ issue: issueSelector, tag: tagSelector, ...guards }), (input) => removeTag(context, input), true);
  register(server, context, "youtrack_create_tag", z.strictObject({ name: z.string().trim().min(1).max(255), owner: userSelector, visibleFor: z.array(entitySelector).optional(), updateableBy: z.array(entitySelector).optional(), dryRun: z.boolean().default(false) }), (input) => createTag(context, input), false);
}
