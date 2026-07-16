import type { EntitySelector, FieldSelector, IssueSelector } from "../../domain/identifiers.js";
import { DomainValidationError } from "../../domain/identifiers.js";
import type { OperationResult } from "../../domain/operation-result.js";
import type { MutationContext } from "../ports.js";
import type { MutationGuards } from "../mutation-runner.js";
import { loadMutationSchemaEvidence, readIssueExact, resolveFieldFromEvidence } from "./support.js";
import { updateIssueFromSnapshot } from "./update-issue.js";

export interface SetIssueStateInput extends MutationGuards {
  readonly issue: IssueSelector;
  readonly field?: FieldSelector;
  readonly value: EntitySelector;
}

export async function setIssueState(context: MutationContext, input: SetIssueStateInput): Promise<OperationResult<unknown>> {
  const issue = await readIssueExact(context, input.issue);
  const evidence = await loadMutationSchemaEvidence(context, issue.project, { purpose: "existing_issue", probeIssue: { id: issue.id } });
  const candidates = evidence.fields.filter((field) => field.valueType?.toLowerCase() === "state" && field.cardinality === "single");
  if (evidence.mode === "partial" && input.field === undefined) throw new DomainValidationError("field_selector_required_for_partial_schema");
  const field = input.field === undefined
    ? (candidates.length === 1 ? candidates[0] ?? null : null)
    : resolveFieldFromEvidence(evidence, input.field);
  if (field === null) throw new DomainValidationError(candidates.length === 0 ? "state_field_not_found" : "state_field_ambiguous");
  if (field.valueType?.toLowerCase() !== "state" || field.cardinality !== "single") throw new DomainValidationError("field_not_state_compatible");
  return updateIssueFromSnapshot(context, {
    issue: { id: issue.id },
    customFields: [{ field: { id: field.id }, action: "set", value: { kind: "entity", selector: input.value } }],
    ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
    ...(input.expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: input.expectedUpdatedAt }),
  }, "youtrack_set_issue_state", issue, evidence);
}
