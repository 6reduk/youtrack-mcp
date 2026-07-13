import { DomainValidationError } from "../domain/identifiers.js";
import { createOperationResult, type OperationResult } from "../domain/operation-result.js";
import { YouTrackHttpError } from "../infrastructure/http/error-mapper.js";

export function presentResult(result: OperationResult<unknown>): {
  readonly structuredContent: Record<string, unknown>;
  readonly content: { type: "text"; text: string }[];
  readonly isError?: boolean;
} {
  const structuredContent = { ...result };
  return {
    structuredContent,
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    ...(result.status === "failed" ? { isError: true } : {}),
  };
}

export function presentSafeFailure(operation: string, requestId: string, error: unknown) {
  const http = error instanceof YouTrackHttpError ? error : null;
  const invalid = error instanceof DomainValidationError || error instanceof TypeError;
  return presentResult(createOperationResult({
    status: invalid ? "invalid" : http?.kind === "permission_denied" ? "forbidden" : "failed",
    operation,
    requestId,
    error: {
      kind: invalid ? "invalid_input" : http?.kind ?? "unexpected_error",
      message: invalid ? error.message : http?.message ?? "The operation failed safely",
      httpStatus: http?.status ?? null,
      retryable: http?.retryable ?? false,
      details: {},
    },
  }));
}
