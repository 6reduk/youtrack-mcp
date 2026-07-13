import type { IssueSelector, PageRequest } from "../../domain/identifiers.js";
import type { TagSummary } from "../../domain/issue.js";
import type { OperationResult } from "../../domain/operation-result.js";
import { createReadSuccess } from "../../domain/operation-result.js";
import { pageInfo } from "../read-support.js";
import type { ReadContext } from "../ports.js";

export async function listIssueTags(
  context: ReadContext,
  issue: IssueSelector,
  page: PageRequest,
): Promise<OperationResult<{ readonly tags: readonly TagSummary[] }>> {
  const requestId = context.ids.nextId();
  const slice = await context.gateway.listIssueTags(issue, page);
  return createReadSuccess(
    "youtrack_list_issue_tags",
    requestId,
    { tags: slice.items },
    pageInfo(page, slice),
  );
}
