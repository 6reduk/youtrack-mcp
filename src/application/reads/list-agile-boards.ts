import type { PageRequest } from "../../domain/identifiers.js";
import type { OperationResult } from "../../domain/operation-result.js";
import { createOperationResult } from "../../domain/operation-result.js";
import type { AgileBoardSummary } from "../../domain/agile-audit.js";
import { pageInfo } from "../read-support.js";
import type { ReadContext } from "../ports.js";

export async function listAgileBoards(context: ReadContext, page: PageRequest): Promise<OperationResult<{ boards: readonly AgileBoardSummary[] }>> {
  const requestId = context.ids.nextId();
  const slice = await context.gateway.listAgileBoards({ page });
  return createOperationResult({ status: "ok", operation: "youtrack_list_agile_boards", requestId, data: { boards: slice.items }, page: pageInfo(page, slice), warnings: [{
    kind: "upstream_field_unavailable", message: "YouTrack REST API does not expose an archived flag for agile boards; archived is null.",
  }] });
}
