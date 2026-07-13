import type { IssueSelector, PageRequest } from "../../domain/identifiers.js";
import type { LinkSnapshot } from "../../domain/links.js";
import type { OperationResult } from "../../domain/operation-result.js";
import { createReadSuccess } from "../../domain/operation-result.js";
import { pageInfo } from "../read-support.js";
import type { ReadContext } from "../ports.js";

export async function listIssueLinks(
  context: ReadContext,
  issue: IssueSelector,
  page: PageRequest,
): Promise<OperationResult<{ readonly links: readonly LinkSnapshot[] }>> {
  const requestId = context.ids.nextId();
  const slice = await context.gateway.listIssueLinks(issue, page);
  return createReadSuccess(
    "youtrack_list_issue_links",
    requestId,
    { links: slice.items },
    pageInfo(page, slice),
  );
}
