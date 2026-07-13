import type { FieldSelector, IssueSelector, UserSelector } from "../../domain/identifiers.js";
import { DomainValidationError } from "../../domain/identifiers.js";
import type { OperationResult } from "../../domain/operation-result.js";
import type { MutationContext } from "../ports.js";
import type { MutationGuards } from "../mutation-runner.js";
import { loadFields, readIssueExact, resolveFieldExact } from "./support.js";
import { setCustomField } from "./set-custom-field.js";

export type SetAssigneeInput = MutationGuards & {
  readonly issue: IssueSelector;
  readonly field?: FieldSelector;
} & (
  | { readonly action: "set"; readonly user: UserSelector }
  | { readonly action: "clear" }
);

export async function setAssignee(context: MutationContext, input: SetAssigneeInput): Promise<OperationResult<unknown>> {
  const issue = await readIssueExact(context, input.issue);
  const fields = await loadFields(context, issue.project);
  const candidates = fields.filter((field) => field.valueType?.toLowerCase() === "user" && field.cardinality === "single");
  const field = input.field === undefined
    ? (candidates.length === 1 ? candidates[0] ?? null : null)
    : resolveFieldExact(fields, input.field);
  if (field === null) throw new DomainValidationError(candidates.length === 0 ? "user_field_not_found" : "user_field_ambiguous");
  if (field.valueType?.toLowerCase() !== "user" || field.cardinality !== "single") throw new DomainValidationError("field_not_single_user");
  const change = input.action === "clear"
    ? { field: { id: field.id }, action: "clear" as const }
    : { field: { id: field.id }, action: "set" as const, value: { kind: "user" as const, selector: input.user } };
  return setCustomField(context, {
    issue: { id: issue.id }, change,
    ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
    ...(input.expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: input.expectedUpdatedAt }),
  });
}
