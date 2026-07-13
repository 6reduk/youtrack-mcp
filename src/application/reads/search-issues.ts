import type { IssueSection, IssueSnapshot } from "../../domain/issue.js";
import type { PageRequest } from "../../domain/identifiers.js";
import type { OperationResult, Warning } from "../../domain/operation-result.js";
import { createOperationResult } from "../../domain/operation-result.js";
import { pageInfo } from "../read-support.js";
import type { ReadContext } from "../ports.js";
import { ALL_ISSUE_SECTIONS } from "./get-issue.js";

export interface SearchIssuesInput {
  readonly query: string;
  readonly page: PageRequest;
  readonly exactSummary?: string;
  readonly sections?: readonly IssueSection[];
}

export async function searchIssues(
  context: ReadContext,
  input: SearchIssuesInput,
): Promise<OperationResult<{ readonly issues: readonly IssueSnapshot[] }>> {
  const requestId = context.ids.nextId();
  const slice = await context.gateway.searchIssues({
    query: input.query,
    page: input.page,
    sections: input.sections ?? ALL_ISSUE_SECTIONS,
  });
  const issues =
    input.exactSummary === undefined
      ? slice.items
      : slice.items.filter((issue) => issue.summary === input.exactSummary);
  const warnings: Warning[] = [];
  if (input.exactSummary !== undefined && slice.hasMore) {
    warnings.push({
      kind: "exact_summary_page_local",
      message: "Exact summary filtering covers this page only while more candidates exist",
    });
  }

  return createOperationResult({
    status: "ok",
    operation: "youtrack_search_issues",
    requestId,
    data: { issues },
    warnings,
    page: pageInfo(input.page, slice, issues.length),
  });
}
