import type { AgileBoardDetails, AgileBoardSelector } from "../../domain/agile-audit.js";
import type { OperationResult } from "../../domain/operation-result.js";
import { createOperationResult } from "../../domain/operation-result.js";
import type { ReadContext } from "../ports.js";
import { boardResolutionFailure, boardTarget, resolveBoard } from "./agile-support.js";

export async function getAgileBoard(context: ReadContext, selector: AgileBoardSelector): Promise<OperationResult<AgileBoardDetails>> {
  const requestId = context.ids.nextId();
  const resolution = await resolveBoard(context, selector);
  if (resolution.status !== "resolved") return boardResolutionFailure("youtrack_get_agile_board", requestId, resolution);
  const details = await context.gateway.getAgileBoard(resolution.value.id);
  if (details === null) return boardResolutionFailure("youtrack_get_agile_board", requestId, { status: "not_found" });
  return createOperationResult({ status: "ok", operation: "youtrack_get_agile_board", requestId, target: boardTarget(details), data: details, warnings: [
    { kind: "upstream_field_unavailable", message: "YouTrack REST API does not expose an archived flag for agile boards; archived is null." },
    { kind: "upstream_field_unavailable", message: "YouTrack REST API does not expose the fields displayed on cards; cardFields is null." },
  ] });
}
