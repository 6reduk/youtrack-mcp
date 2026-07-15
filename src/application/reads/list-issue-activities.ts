import type { IssueActivityCategory, IssueActivitySummary } from "../../domain/agile-audit.js";
import type { IssueSelector, PageRequest } from "../../domain/identifiers.js";
import type { OperationResult } from "../../domain/operation-result.js";
import { createOperationResult } from "../../domain/operation-result.js";
import { pageInfo } from "../read-support.js";
import type { ReadContext } from "../ports.js";

export interface ListIssueActivitiesInput {
  readonly issue: IssueSelector; readonly page: PageRequest; readonly categories: readonly IssueActivityCategory[];
  readonly fieldNames: readonly string[]; readonly reverse: boolean; readonly start?: number; readonly end?: number;
}

export async function listIssueActivities(context: ReadContext, input: ListIssueActivitiesInput): Promise<OperationResult<{ activities: readonly IssueActivitySummary[] }>> {
  const requestId = context.ids.nextId();
  const issue = await context.gateway.getIssue(input.issue, ["system"]);
  if (issue === null) return createOperationResult({ status: "not_found", operation: "youtrack_list_issue_activities", requestId, error: {
    kind: "issue_not_found", message: "No issue exactly matched the supplied selector", httpStatus: null, retryable: false, details: {},
  } });
  const slice = await context.gateway.listIssueActivities(input);
  return createOperationResult({ status: "ok", operation: "youtrack_list_issue_activities", requestId,
    target: { kind: "issue", id: issue.id, idReadable: issue.idReadable, name: issue.summary, url: issue.url },
    data: { activities: slice.items }, page: pageInfo(input.page, slice), warnings: input.fieldNames.length === 0 ? [] : [{
      kind: "client_side_filter", message: "fieldNames is an exact post-filter because the YouTrack activity endpoint has no field filter; pagination reflects the upstream page.",
    }] });
}
