import type { IssueSelector, LinkDirection, LinkTypeSelector, PageRequest } from "../../domain/identifiers.js";
import type { IssueReference } from "../../domain/links.js";
import type { OperationResult } from "../../domain/operation-result.js";
import { createReadSuccess } from "../../domain/operation-result.js";
import { pageInfo } from "../read-support.js";
import type { ReadContext } from "../ports.js";

export interface ListSubtasksInput {
  readonly parent: IssueSelector;
  readonly linkType: LinkTypeSelector;
  readonly parentToChildDirection: LinkDirection;
  readonly page: PageRequest;
}

export async function listSubtasks(
  context: ReadContext,
  input: ListSubtasksInput,
): Promise<OperationResult<{ readonly issues: readonly IssueReference[] }>> {
  const requestId = context.ids.nextId();
  const slice = await context.gateway.listRelatedIssues({
    issue: input.parent,
    linkType: input.linkType,
    direction: input.parentToChildDirection,
    page: input.page,
  });
  return createReadSuccess(
    "youtrack_list_subtasks",
    requestId,
    { issues: slice.items },
    pageInfo(input.page, slice),
  );
}
