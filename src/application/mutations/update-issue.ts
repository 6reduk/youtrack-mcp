import type { CustomFieldChange } from "../../domain/field-values.js";
import { DomainValidationError, type IssueSelector } from "../../domain/identifiers.js";
import type { OperationResult } from "../../domain/operation-result.js";
import { verifyPostconditions, type Postcondition } from "../../domain/verification.js";
import type { IssueSnapshot } from "../../domain/issue.js";
import type { MutationContext, SerializedCustomFieldChange } from "../ports.js";
import { runIssueMutation, type MutationGuards } from "../mutation-runner.js";
import { fieldValueEquals, loadFields, observedField, readIssueExact, resolveFieldExact, serializeChange } from "./support.js";

export interface UpdateIssueInput extends MutationGuards {
  readonly issue: IssueSelector;
  readonly summary?: { readonly action: "set"; readonly value: string };
  readonly description?: { readonly action: "set"; readonly value: string } | { readonly action: "clear" };
  readonly customFields?: readonly CustomFieldChange[];
}

export async function updateIssue(
  context: MutationContext,
  input: UpdateIssueInput,
  operation = "youtrack_update_issue",
): Promise<OperationResult<unknown>> {
  const requestId = context.ids.nextId();
  const before = await readIssueExact(context, input.issue);
  const changes = input.customFields ?? [];
  if (input.summary === undefined && input.description === undefined && changes.length === 0) throw new DomainValidationError("at_least_one_change_required");
  if (input.summary?.value.trim().length === 0 || (input.summary?.value.length ?? 0) > 1_000) throw new DomainValidationError("invalid_summary");
  const fields = changes.length === 0 ? [] : await loadFields(context, before.project);
  const serialized: SerializedCustomFieldChange[] = [];
  const conditions: Postcondition<IssueSnapshot, unknown>[] = [];
  const seen = new Set<string>();
  for (const change of changes) {
    const field = resolveFieldExact(fields, change.field);
    if (seen.has(field.id)) throw new DomainValidationError("duplicate_field_change");
    seen.add(field.id);
    const encoded = await serializeChange(context, field, change);
    serialized.push(encoded.serialized);
    conditions.push({ name: `customField:${field.id}`, expected: encoded.expected, observe: (issue) => observedField(issue, field.id), equals: fieldValueEquals });
  }
  if (input.summary !== undefined) conditions.push({ name: "summary", expected: input.summary.value, observe: (issue) => issue.summary });
  const description = input.description?.action === "clear" ? null : input.description?.value;
  if (input.description !== undefined) conditions.push({ name: "description", expected: description, observe: (issue) => issue.description });
  const command = {
    ...(input.summary === undefined ? {} : { summary: input.summary.value }),
    ...(input.description === undefined ? {} : { description: input.description.action === "clear" ? null : input.description.value }),
    ...(serialized.length === 0 ? {} : { customFields: serialized }),
  };
  return runIssueMutation({
    operation, requestId, before, guards: input,
    plan: { target: before.idReadable, changes: conditions.map((condition) => condition.name), writeCount: 1 },
    write: async () => { await context.gateway.updateIssue({ id: before.id }, command); },
    reread: () => context.gateway.getIssue({ id: before.id }, ["system", "description", "customFields", "users"]),
    verify: (snapshot) => verifyPostconditions(snapshot, conditions),
  });
}
