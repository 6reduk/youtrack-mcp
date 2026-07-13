import type { EntitySelector, FieldSelector, IssueSelector } from "../../domain/identifiers.js";
import { DomainValidationError } from "../../domain/identifiers.js";
import type { OperationResult } from "../../domain/operation-result.js";
import type { MutationContext } from "../ports.js";
import type { MutationGuards } from "../mutation-runner.js";
import { loadFields, readIssueExact, resolveFieldExact } from "./support.js";
import { setCustomField } from "./set-custom-field.js";

export interface SetIssueStateInput extends MutationGuards {
  readonly issue: IssueSelector;
  readonly field?: FieldSelector;
  readonly value: EntitySelector;
}

export async function setIssueState(context: MutationContext, input: SetIssueStateInput): Promise<OperationResult<unknown>> {
  const issue = await readIssueExact(context, input.issue);
  const fields = await loadFields(context, issue.project);
  const candidates = fields.filter((field) => field.valueType?.toLowerCase() === "state" && field.cardinality === "single");
  const field = input.field === undefined
    ? (candidates.length === 1 ? candidates[0] ?? null : null)
    : resolveFieldExact(fields, input.field);
  if (field === null) throw new DomainValidationError(candidates.length === 0 ? "state_field_not_found" : "state_field_ambiguous");
  if (field.valueType?.toLowerCase() !== "state" || field.cardinality !== "single") throw new DomainValidationError("field_not_state_compatible");
  return setCustomField(context, {
    issue: { id: issue.id },
    change: { field: { id: field.id }, action: "set", value: { kind: "entity", selector: input.value } },
    ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
    ...(input.expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: input.expectedUpdatedAt }),
  });
}
