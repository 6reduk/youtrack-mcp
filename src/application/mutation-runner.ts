import type { IssueSnapshot } from "../domain/issue.js";
import { createOperationResult, type OperationResult, type Warning } from "../domain/operation-result.js";
import type { VerificationResult } from "../domain/verification.js";
import { YouTrackHttpError } from "../infrastructure/http/error-mapper.js";

export interface MutationGuards {
  readonly dryRun?: boolean;
  readonly expectedUpdatedAt?: number;
}

export interface MutationPlan {
  readonly target: string;
  readonly changes: readonly string[];
  readonly writeCount: number;
}

interface RunMutationOptions {
  readonly operation: string;
  readonly requestId: string;
  readonly before: IssueSnapshot;
  readonly guards: MutationGuards;
  readonly plan: MutationPlan;
  readonly write: () => Promise<void>;
  readonly reread: () => Promise<IssueSnapshot | null>;
  readonly verify: (snapshot: IssueSnapshot) => VerificationResult;
}

function target(issue: IssueSnapshot) {
  return { kind: "issue" as const, id: issue.id, idReadable: issue.idReadable, url: issue.url };
}

export async function runIssueMutation(
  options: RunMutationOptions,
): Promise<OperationResult<{ readonly plan: MutationPlan }>> {
  if (
    options.guards.expectedUpdatedAt !== undefined &&
    options.before.updatedAt !== null &&
    options.before.updatedAt !== options.guards.expectedUpdatedAt
  ) {
    return createOperationResult({
      status: "conflict",
      operation: options.operation,
      requestId: options.requestId,
      target: target(options.before),
      before: options.before,
      data: { plan: options.plan },
      error: {
        kind: "updated_at_mismatch",
        message: "The issue changed after the caller's expected snapshot",
        httpStatus: null,
        retryable: false,
        details: { expectedUpdatedAt: options.guards.expectedUpdatedAt, actualUpdatedAt: options.before.updatedAt },
      },
    });
  }
  const guardWarnings: Warning[] =
    options.guards.expectedUpdatedAt !== undefined && options.before.updatedAt === null
      ? [{ kind: "updated_at_unavailable", message: "The expectedUpdatedAt guard could not be evaluated because the timestamp is not visible" }]
      : [];
  if (options.guards.dryRun === true) {
    return createOperationResult({
      status: "ok",
      operation: options.operation,
      requestId: options.requestId,
      target: target(options.before),
      before: options.before,
      data: { plan: options.plan },
      warnings: guardWarnings,
      journal: [{ name: "write", status: "planned", verified: null }],
    });
  }

  let uncertain: YouTrackHttpError | null = null;
  try {
    await options.write();
  } catch (error: unknown) {
    if (
      error instanceof YouTrackHttpError &&
      (error.kind === "request_timeout" || error.kind === "transport_error")
    ) {
      uncertain = error;
    } else {
      throw error;
    }
  }

  const after = await options.reread();
  if (after === null) {
    return createOperationResult({
      status: "failed",
      operation: options.operation,
      requestId: options.requestId,
      target: target(options.before),
      before: options.before,
      data: { plan: options.plan },
      verified: false,
      journal: [{ name: "write", status: uncertain === null ? "completed" : "unknown", verified: false }],
      error: {
        kind: uncertain === null ? "post_read_missing" : "uncertain_write",
        message: "The issue could not be read after the write attempt",
        httpStatus: uncertain?.status ?? null,
        retryable: false,
        details: {},
      },
    });
  }
  const verification = options.verify(after);
  const warnings: Warning[] = uncertain === null ? [...guardWarnings] : [...guardWarnings, {
    kind: "write_response_uncertain_reconciled",
    message: "The write response was uncertain; the result was determined only by a reconciliation read",
  }];
  return createOperationResult({
    status: verification.verified ? "updated" : "failed",
    operation: options.operation,
    requestId: options.requestId,
    target: target(after),
    before: options.before,
    after,
    data: { plan: options.plan },
    verified: verification.verified,
    warnings,
    journal: [{ name: "write", status: uncertain === null ? "completed" : "unknown", verified: verification.verified }],
    ...(verification.verified ? {} : {
      error: {
        kind: uncertain === null ? "postcondition_mismatch" : "uncertain_write",
        message: "The reconciliation read did not prove every requested postcondition",
        httpStatus: uncertain?.status ?? null,
        retryable: false,
        details: { mismatchCount: verification.mismatches.length },
      },
    }),
  });
}
