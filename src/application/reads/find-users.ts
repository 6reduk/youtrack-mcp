import { DomainValidationError, getSelectorEntry } from "../../domain/identifiers.js";
import type { UserSummary } from "../../domain/issue.js";
import type { OperationResult, Warning } from "../../domain/operation-result.js";
import { createOperationResult } from "../../domain/operation-result.js";
import { pageInfo } from "../read-support.js";
import type { FindUsersInput, ReadContext } from "../ports.js";

export async function findUsers(
  context: ReadContext,
  input: FindUsersInput,
): Promise<OperationResult<{ readonly users: readonly UserSummary[] }>> {
  if (input.selector === undefined && input.query === undefined) {
    throw new DomainValidationError("At least one user selector or query is required");
  }

  const requestId = context.ids.nextId();
  const slice = await context.gateway.findUsers({
    page: input.page,
    includeBanned: input.includeBanned,
    ...(input.selector === undefined ? {} : { selector: input.selector }),
    ...(input.query === undefined ? {} : { query: input.query }),
  });
  let users = slice.items;
  if (input.selector !== undefined) {
    const selector = getSelectorEntry(input.selector, ["id", "login", "email"]);
    users = users.filter((user) => user[selector.key] === selector.value);
  }
  const warnings: Warning[] = [];
  if (input.selector !== undefined && slice.hasMore) {
    warnings.push({
      kind: "exact_selector_page_local",
      message: "Exact user filtering covers this page only while more candidates exist",
    });
  }
  return createOperationResult({
    status: "ok",
    operation: "youtrack_find_users",
    requestId,
    data: { users },
    warnings,
    page: pageInfo(input.page, slice, users.length),
  });
}
