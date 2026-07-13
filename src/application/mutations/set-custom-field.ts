import type { CustomFieldChange } from "../../domain/field-values.js";
import type { IssueSelector } from "../../domain/identifiers.js";
import type { OperationResult } from "../../domain/operation-result.js";
import type { MutationContext } from "../ports.js";
import type { MutationGuards } from "../mutation-runner.js";
import { updateIssue } from "./update-issue.js";

export interface SetCustomFieldInput extends MutationGuards {
  readonly issue: IssueSelector;
  readonly change: CustomFieldChange;
}

export function setCustomField(context: MutationContext, input: SetCustomFieldInput): Promise<OperationResult<unknown>> {
  return updateIssue(context, { ...input, customFields: [input.change] }, "youtrack_set_custom_field");
}
