import type { IssueSection, IssueSnapshot } from "../../domain/issue.js";
import type { IssueSelector } from "../../domain/identifiers.js";
import type { OperationResult } from "../../domain/operation-result.js";
import { createOperationResult } from "../../domain/operation-result.js";
import type { ReadContext } from "../ports.js";

export const ALL_ISSUE_SECTIONS: readonly IssueSection[] = [
  "system",
  "description",
  "customFields",
  "tags",
  "links",
  "users",
];

export async function getIssue(
  context: ReadContext,
  issue: IssueSelector,
  sections: readonly IssueSection[] = ALL_ISSUE_SECTIONS,
): Promise<OperationResult<IssueSnapshot>> {
  const requestId = context.ids.nextId();
  const snapshot = await context.gateway.getIssue(issue, sections);
  if (snapshot === null) {
    return createOperationResult({
      status: "not_found",
      operation: "youtrack_get_issue",
      requestId,
      error: {
        kind: "issue_not_found",
        message: "The issue was not found",
        httpStatus: null,
        retryable: false,
        details: {},
      },
    });
  }

  return createOperationResult({
    status: "ok",
    operation: "youtrack_get_issue",
    requestId,
    target: {
      kind: "issue",
      id: snapshot.id,
      idReadable: snapshot.idReadable,
      url: snapshot.url,
    },
    data: snapshot,
  });
}
