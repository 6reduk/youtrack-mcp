import type { PageRequest } from "../../domain/identifiers.js";
import type { TagSummary } from "../../domain/issue.js";
import type { OperationResult, Warning } from "../../domain/operation-result.js";
import { createOperationResult } from "../../domain/operation-result.js";
import { pageInfo } from "../read-support.js";
import type { ReadContext } from "../ports.js";

export interface ListTagsInput {
  readonly page: PageRequest;
  readonly exactName?: string;
  readonly query?: string;
}

export async function listTags(
  context: ReadContext,
  input: ListTagsInput,
): Promise<OperationResult<{ readonly tags: readonly TagSummary[] }>> {
  const requestId = context.ids.nextId();
  const serverQuery = input.query ?? input.exactName;
  const slice = await context.gateway.listTags({
    page: input.page,
    ...(serverQuery === undefined ? {} : { query: serverQuery }),
  });
  const tags =
    input.exactName === undefined
      ? slice.items
      : slice.items.filter((tag) => tag.name === input.exactName);
  const warnings: Warning[] = [];
  if (input.exactName !== undefined && slice.hasMore) {
    warnings.push({
      kind: "exact_name_page_local",
      message: "Exact name filtering covers this page only while more candidates exist",
    });
  }
  return createOperationResult({
    status: "ok",
    operation: "youtrack_list_tags",
    requestId,
    data: { tags },
    warnings,
    page: pageInfo(input.page, slice, tags.length),
  });
}
