import type { AgileBoardSelector, AgileBoardSummary } from "../../domain/agile-audit.js";
import type { Candidate, OperationResult, SafeTarget } from "../../domain/operation-result.js";
import { createOperationResult } from "../../domain/operation-result.js";
import type { Resolution } from "../../domain/resolution.js";
import { resolveExact } from "../../domain/resolution.js";
import type { ReadContext } from "../ports.js";

export function boardTarget(board: AgileBoardSummary): SafeTarget {
  return { kind: "agile_board", id: board.id, name: board.name, url: board.url };
}

function boardCandidate(board: AgileBoardSummary): Candidate {
  return { kind: "agile_board", id: board.id, name: board.name, url: board.url };
}

export async function resolveBoard(context: ReadContext, selector: AgileBoardSelector): Promise<Resolution<AgileBoardSummary>> {
  return resolveExact({
    selector,
    candidates: await context.gateway.findAgileBoards(selector),
    accessors: { id: (board) => board.id, exactName: (board) => board.name },
  });
}

export function boardResolutionFailure<T>(operation: string, requestId: string, resolution: Exclude<Resolution<AgileBoardSummary>, { status: "resolved" }>): OperationResult<T> {
  if (resolution.status === "not_found") {
    return createOperationResult({ status: "not_found", operation, requestId, error: {
      kind: "agile_board_not_found", message: "No agile board exactly matched the supplied selector", httpStatus: null, retryable: false, details: {},
    } });
  }
  return createOperationResult({ status: "ambiguous", operation, requestId, candidates: resolution.candidates.map(boardCandidate), error: {
    kind: "agile_board_ambiguous", message: "More than one agile board exactly matched the supplied selector", httpStatus: null, retryable: false,
    details: { totalMatches: resolution.totalMatches, candidatesTruncated: resolution.truncated },
  } });
}
