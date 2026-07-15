import type { AgileBoardSelector, SprintSummary } from "../../domain/agile-audit.js";
import type { PageRequest } from "../../domain/identifiers.js";
import type { OperationResult } from "../../domain/operation-result.js";
import { createOperationResult } from "../../domain/operation-result.js";
import { pageInfo } from "../read-support.js";
import type { ReadContext } from "../ports.js";
import { boardResolutionFailure, boardTarget, resolveBoard } from "./agile-support.js";

export async function listSprints(context: ReadContext, board: AgileBoardSelector, page: PageRequest): Promise<OperationResult<{ sprints: readonly SprintSummary[] }>> {
  const requestId = context.ids.nextId();
  const resolution = await resolveBoard(context, board);
  if (resolution.status !== "resolved") return boardResolutionFailure("youtrack_list_sprints", requestId, resolution);
  const details = await context.gateway.getAgileBoard(resolution.value.id);
  if (details === null) return boardResolutionFailure("youtrack_list_sprints", requestId, { status: "not_found" });
  const slice = await context.gateway.listSprints({ boardId: details.id, currentSprintId: details.currentSprint?.id ?? null, page });
  return createOperationResult({ status: "ok", operation: "youtrack_list_sprints", requestId, target: boardTarget(details), data: { sprints: slice.items }, page: pageInfo(page, slice) });
}
