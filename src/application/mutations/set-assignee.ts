import type { FieldSelector, IssueSelector, UserSelector } from "../../domain/identifiers.js";
import { DomainValidationError } from "../../domain/identifiers.js";
import type { OperationResult } from "../../domain/operation-result.js";
import type { MutationContext } from "../ports.js";
import type { MutationGuards } from "../mutation-runner.js";
import { loadMutationSchemaEvidence, readIssueExact, resolveFieldFromEvidence } from "./support.js";
import { updateIssueFromSnapshot } from "./update-issue.js";

export type SetAssigneeInput = MutationGuards & {
  readonly issue: IssueSelector;
  readonly field?: FieldSelector;
} & (
  | { readonly action: "set"; readonly user: UserSelector }
  | { readonly action: "clear" }
);

export async function setAssignee(context: MutationContext, input: SetAssigneeInput): Promise<OperationResult<unknown>> {
  const issue = await readIssueExact(context, input.issue);
  const evidence = await loadMutationSchemaEvidence(context, issue.project, { purpose: "existing_issue", probeIssue: { id: issue.id } });
  const candidates = evidence.fields.filter((field) => field.valueType?.toLowerCase() === "user" && field.cardinality === "single");
  if (evidence.mode === "partial" && input.field === undefined) throw new DomainValidationError("field_selector_required_for_partial_schema");
  const field = input.field === undefined
    ? (candidates.length === 1 ? candidates[0] ?? null : null)
    : resolveFieldFromEvidence(evidence, input.field);
  if (field === null) throw new DomainValidationError(candidates.length === 0 ? "user_field_not_found" : "user_field_ambiguous");
  if (field.valueType?.toLowerCase() !== "user" || field.cardinality !== "single") throw new DomainValidationError("field_not_single_user");
  const change = input.action === "clear"
    ? { field: { id: field.id }, action: "clear" as const }
    : { field: { id: field.id }, action: "set" as const, value: { kind: "user" as const, selector: input.user } };
  return updateIssueFromSnapshot(context, {
    issue: { id: issue.id }, customFields: [change],
    ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
    ...(input.expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: input.expectedUpdatedAt }),
  }, "youtrack_set_assignee", issue, evidence);
}
