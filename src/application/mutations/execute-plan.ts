import { timingSafeEqual } from "node:crypto";

import {
  EXECUTE_PLAN_MAX_OPERATIONS,
  EXECUTE_PLAN_VERSION,
  type ExecutePlanResultData,
  type ExecutePlanStepResult,
} from "../../domain/execute-plan.js";
import { DomainValidationError } from "../../domain/identifiers.js";
import {
  createOperationResult,
  type OperationResult,
  type OperationStatus,
  type OperationStep,
  type SafeError,
  type Warning,
} from "../../domain/operation-result.js";
import { YouTrackHttpError } from "../../infrastructure/http/error-mapper.js";
import type { MutationContext } from "../ports.js";
import {
  assertLinkWouldNotCreateCycle,
  resolveLinkContainerId,
} from "./links.js";
import {
  mapExecutePlanError,
  planExecutePlan,
  readPlannedOperationSnapshot,
  type ExecutePlanInput,
  type PlannedExecutePlan,
  type PlannedExecutePlanOperation,
  type PlannedWrite,
} from "./execute-plan-planner.js";

const OPERATION = "youtrack_execute_plan";
const HASH_PATTERN = /^[0-9a-f]{64}$/;

interface TerminalExecution {
  readonly index: number;
  readonly status: "conflict" | "failed" | "uncertain";
  /** Aggregate status when this failure happened before a write was dispatched. */
  readonly aggregateStatus?: OperationStatus;
  readonly error: SafeError;
  readonly requestId: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly warnings: readonly Warning[];
}

function warningKey(warning: Warning): string {
  const details = warning.details === undefined
    ? ""
    : JSON.stringify(Object.fromEntries(Object.entries(warning.details).sort(([left], [right]) => left.localeCompare(right))));
  return `${warning.kind}\n${details}`;
}

function deduplicateWarnings(warnings: readonly Warning[]): readonly Warning[] {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = warningKey(warning);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function journalForStep(step: ExecutePlanStepResult): OperationStep {
  switch (step.status) {
    case "planned":
      return { name: `operation:${String(step.index)}`, status: "planned", verified: null };
    case "already_satisfied":
      return { name: `operation:${String(step.index)}`, status: "completed", verified: true };
    case "updated":
      return {
        name: `operation:${String(step.index)}`,
        status: "completed",
        verified: true,
        ...(step.requestId === null ? {} : { requestId: step.requestId }),
      };
    case "conflict":
    case "failed":
      return {
        name: `operation:${String(step.index)}`,
        status: "failed",
        verified: false,
        ...(step.requestId === null ? {} : { requestId: step.requestId }),
      };
    case "uncertain":
      return {
        name: `operation:${String(step.index)}`,
        status: "unknown",
        verified: false,
        ...(step.requestId === null ? {} : { requestId: step.requestId }),
      };
    case "skipped":
      return { name: `operation:${String(step.index)}`, status: "skipped", verified: null };
  }
}

function resultData(
  plan: PlannedExecutePlan | null,
  operationCount: number,
  steps: readonly ExecutePlanStepResult[],
  completedWriteCount: number,
  alreadySatisfiedCount: number,
  stoppedAtIndex: number | null,
): ExecutePlanResultData {
  return {
    planVersion: EXECUTE_PLAN_VERSION,
    planHash: plan?.planHash ?? null,
    resolvedPlan: plan?.resolvedPlan ?? null,
    operationCount,
    maxOperations: EXECUTE_PLAN_MAX_OPERATIONS,
    possibleWriteCount: plan === null ? 0 : plan.operations.length,
    completedWriteCount,
    alreadySatisfiedCount,
    stoppedAtIndex,
    partialCompletion: completedWriteCount > 0 && stoppedAtIndex !== null,
    operations: steps,
  };
}

function constantTimeHashEquals(left: string, right: string): boolean {
  if (!HASH_PATTERN.test(left) || !HASH_PATTERN.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function invalidPhaseResult(
  requestId: string,
  input: ExecutePlanInput,
  error: DomainValidationError,
): OperationResult<ExecutePlanResultData> {
  const mapped = mapExecutePlanError(error);
  const steps = input.operations.map((operation, index): ExecutePlanStepResult => ({
    index,
    operationId: operation.operationId ?? null,
    inputKind: operation.kind,
    target: null,
    status: "skipped",
    alreadySatisfied: null,
    verified: null,
    warnings: [],
    error: null,
    requestId: null,
    before: null,
    after: null,
  }));
  return createOperationResult({
    status: "invalid",
    operation: OPERATION,
    requestId,
    data: resultData(null, input.operations.length, steps, 0, 0, null),
    verified: false,
    journal: steps.map(journalForStep),
    error: mapped.error,
  });
}

function previewSteps(plan: PlannedExecutePlan): readonly ExecutePlanStepResult[] {
  return plan.operations.map((runtime) => ({
    index: runtime.canonical.index,
    operationId: runtime.canonical.operationId,
    inputKind: runtime.canonical.inputKind,
    target: runtime.target,
    status: "planned",
    alreadySatisfied: runtime.isSatisfied(runtime.preflightSnapshot),
    verified: null,
    warnings: runtime.warnings,
    error: null,
    requestId: null,
    before: null,
    after: null,
  }));
}

async function prepareWrite(
  context: MutationContext,
  runtime: PlannedExecutePlanOperation,
  before: Parameters<PlannedExecutePlanOperation["isSatisfied"]>[0],
): Promise<(requestId: string) => Promise<void>> {
  const write: PlannedWrite = runtime.write;
  switch (write.kind) {
    case "update_issue":
      return async (requestId) => {
        await context.gateway.updateIssue({ id: runtime.canonical.subjectIssueId }, write.command, requestId);
      };
    case "tag_membership":
      return async (requestId) => {
        if (write.desiredPresent) {
          await context.gateway.addIssueTag({ id: runtime.canonical.subjectIssueId }, write.tagId, requestId);
        } else {
          await context.gateway.removeIssueTag({ id: runtime.canonical.subjectIssueId }, write.tagId, requestId);
        }
      };
    case "issue_link": {
      if (write.preventCycle) {
        await assertLinkWouldNotCreateCycle(
          context,
          runtime.canonical.subjectIssueId,
          write.targetIssueId,
          write.linkTypeId,
          write.direction,
        );
      }
      const containerId = await resolveLinkContainerId(
        context,
        before,
        write.linkTypeId,
        write.direction,
      );
      return async (requestId) => {
        if (write.desiredPresent) {
          await context.gateway.addIssueLink(
            { id: runtime.canonical.subjectIssueId },
            containerId,
            write.targetIssueId,
            requestId,
          );
        } else {
          await context.gateway.removeIssueLink(
            { id: runtime.canonical.subjectIssueId },
            containerId,
            write.targetIssueId,
            requestId,
          );
        }
      };
    }
  }
}

function isUncertainDispatch(error: unknown): error is YouTrackHttpError {
  return error instanceof YouTrackHttpError
    && (error.kind === "request_timeout" || error.kind === "transport_error");
}

function safeError(
  kind: string,
  message: string,
  httpStatus: number | null = null,
  details: SafeError["details"] = {},
): SafeError {
  return { kind, message, httpStatus, retryable: false, details };
}

async function executeChangedStep(
  context: MutationContext,
  runtime: PlannedExecutePlanOperation,
  before: Parameters<PlannedExecutePlanOperation["isSatisfied"]>[0],
): Promise<ExecutePlanStepResult | TerminalExecution> {
  const index = runtime.canonical.index;
  let write: (requestId: string) => Promise<void>;
  try {
    write = await prepareWrite(context, runtime, before);
  } catch (error: unknown) {
    const mapped = mapExecutePlanError(error);
    return {
      index,
      status: mapped.status === "conflict" ? "conflict" : "failed",
      aggregateStatus: mapped.status,
      error: mapped.error,
      requestId: null,
      before,
      after: null,
      warnings: runtime.warnings,
    };
  }
  const requestId = context.ids.nextId();
  let dispatchError: unknown = null;
  try {
    await write(requestId);
  } catch (error: unknown) {
    dispatchError = error;
  }

  let after: Awaited<ReturnType<MutationContext["gateway"]["getIssue"]>> = null;
  let reconciliationError: unknown = null;
  try {
    after = await readPlannedOperationSnapshot(context, runtime);
  } catch (error: unknown) {
    reconciliationError = error;
  }

  const uncertainError = isUncertainDispatch(dispatchError) ? dispatchError : null;
  if (dispatchError !== null && uncertainError === null) {
    const mapped = mapExecutePlanError(dispatchError);
    return {
      index,
      status: "failed",
      error: mapped.error,
      requestId,
      before,
      after,
      warnings: runtime.warnings,
    };
  }
  if (reconciliationError !== null || after === null) {
    if (uncertainError !== null) {
      return {
        index,
        status: "uncertain",
        error: safeError(
          "uncertain_write",
          "The write outcome could not be proven by the reconciliation read",
          uncertainError.status,
        ),
        requestId,
        before,
        after: null,
        warnings: runtime.warnings,
      };
    }
    return {
      index,
      status: "failed",
      error: safeError("post_read_missing", "The issue could not be read after the write attempt"),
      requestId,
      before,
      after: null,
      warnings: runtime.warnings,
    };
  }
  if (!runtime.isSatisfied(after)) {
    return {
      index,
      status: uncertainError === null ? "failed" : "uncertain",
      error: uncertainError !== null
        ? safeError(
          "uncertain_write",
          "The write outcome was uncertain and the desired state was not proven",
          uncertainError.status,
        )
        : safeError("postcondition_mismatch", "The reconciliation read did not prove every requested postcondition"),
      requestId,
      before,
      after,
      warnings: runtime.warnings,
    };
  }

  const warnings: Warning[] = [...runtime.warnings];
  if (uncertainError !== null) {
    warnings.push({
      kind: "write_response_uncertain_reconciled",
      message: "The write response was uncertain, but reconciliation proved the desired state.",
    });
  }
  return {
    index,
    operationId: runtime.canonical.operationId,
    inputKind: runtime.canonical.inputKind,
    target: runtime.target,
    status: "updated",
    alreadySatisfied: false,
    verified: true,
    warnings,
    error: null,
    requestId,
    before,
    after,
  };
}

function skippedStep(runtime: PlannedExecutePlanOperation): ExecutePlanStepResult {
  return {
    index: runtime.canonical.index,
    operationId: runtime.canonical.operationId,
    inputKind: runtime.canonical.inputKind,
    target: runtime.target,
    status: "skipped",
    alreadySatisfied: null,
    verified: null,
    warnings: runtime.warnings,
    error: null,
    requestId: null,
    before: null,
    after: null,
  };
}

function terminalStep(
  runtime: PlannedExecutePlanOperation,
  terminal: TerminalExecution,
): ExecutePlanStepResult {
  return {
    index: terminal.index,
    operationId: runtime.canonical.operationId,
    inputKind: runtime.canonical.inputKind,
    target: runtime.target,
    status: terminal.status,
    alreadySatisfied: false,
    verified: false,
    warnings: terminal.warnings,
    error: terminal.error,
    requestId: terminal.requestId,
    before: terminal.before,
    after: terminal.after,
  };
}

/**
 * Executes the two-phase batch contract. Every invocation rebuilds the plan;
 * no prepared-plan state or replay ledger is retained.
 */
export async function executePlan(
  context: MutationContext,
  input: ExecutePlanInput,
): Promise<OperationResult<ExecutePlanResultData>> {
  const requestId = context.ids.nextId();
  const rawConfirm = (input as { readonly confirm?: boolean }).confirm;
  const rawPlanHash = (input as { readonly planHash?: string }).planHash;
  if (
    (input.dryRun && rawConfirm === true)
    || (!input.dryRun && (rawConfirm !== true || rawPlanHash === undefined || !HASH_PATTERN.test(rawPlanHash)))
  ) {
    return invalidPhaseResult(requestId, input, new DomainValidationError("invalid_execute_plan_phase"));
  }

  const planning = await planExecutePlan(context, input.operations);
  if (!planning.ok) {
    const warnings = deduplicateWarnings(planning.failure.operations.flatMap((step) => step.warnings));
    return createOperationResult({
      status: planning.failure.status,
      operation: OPERATION,
      requestId,
      data: resultData(null, input.operations.length, planning.failure.operations, 0, 0, planning.failure.index),
      verified: false,
      warnings,
      journal: planning.failure.operations.map(journalForStep),
      error: planning.failure.error,
    });
  }

  const plan = planning.plan;
  if (input.dryRun) {
    const steps = previewSteps(plan);
    return createOperationResult({
      status: "ok",
      operation: OPERATION,
      requestId,
      data: resultData(plan, input.operations.length, steps, 0, 0, null),
      warnings: deduplicateWarnings(steps.flatMap((step) => step.warnings)),
      journal: steps.map(journalForStep),
    });
  }

  if (!constantTimeHashEquals(input.planHash, plan.planHash)) {
    const steps = plan.operations.map(skippedStep);
    return createOperationResult({
      status: "conflict",
      operation: OPERATION,
      requestId,
      data: resultData(plan, input.operations.length, steps, 0, 0, null),
      verified: false,
      warnings: deduplicateWarnings(steps.flatMap((step) => step.warnings)),
      journal: steps.map(journalForStep),
      error: safeError("plan_hash_mismatch", "The confirmed hash does not match the rebuilt resolved plan"),
    });
  }

  const steps: ExecutePlanStepResult[] = [];
  let completedWriteCount = 0;
  let alreadySatisfiedCount = 0;
  let stoppedAtIndex: number | null = null;
  let causalError: SafeError | null = null;
  let terminalStatus: OperationStatus | null = null;

  for (let index = 0; index < plan.operations.length; index += 1) {
    const runtime = plan.operations[index];
    if (runtime === undefined) continue;
    if (stoppedAtIndex !== null) {
      steps.push(skippedStep(runtime));
      continue;
    }

    let before: Awaited<ReturnType<MutationContext["gateway"]["getIssue"]>>;
    try {
      before = await readPlannedOperationSnapshot(context, runtime);
    } catch (error: unknown) {
      const mapped = mapExecutePlanError(error);
      const terminal: TerminalExecution = {
        index,
        status: mapped.status === "conflict" ? "conflict" : "failed",
        aggregateStatus: mapped.status,
        error: mapped.error,
        requestId: null,
        before: null,
        after: null,
        warnings: runtime.warnings,
      };
      steps.push(terminalStep(runtime, terminal));
      stoppedAtIndex = index;
      causalError = terminal.error;
      terminalStatus = terminal.aggregateStatus ?? (terminal.status === "conflict" ? "conflict" : "failed");
      continue;
    }
    if (runtime.isSatisfied(before)) {
      alreadySatisfiedCount += 1;
      steps.push({
        index,
        operationId: runtime.canonical.operationId,
        inputKind: runtime.canonical.inputKind,
        target: runtime.target,
        status: "already_satisfied",
        alreadySatisfied: true,
        verified: true,
        warnings: runtime.warnings,
        error: null,
        requestId: null,
        before,
        after: before,
      });
      continue;
    }
    if (before.updatedAt === null || before.updatedAt !== runtime.canonical.expectedUpdatedAt) {
      const unavailable = before.updatedAt === null;
      const terminal: TerminalExecution = {
        index,
        status: "conflict",
        error: safeError(
          unavailable ? "updated_at_unavailable" : "updated_at_mismatch",
          unavailable
            ? "The issue timestamp is not visible during the immediate pre-write check"
            : "The issue changed after the plan was prepared",
        ),
        requestId: null,
        before,
        after: null,
        warnings: runtime.warnings,
      };
      steps.push(terminalStep(runtime, terminal));
      stoppedAtIndex = index;
      causalError = terminal.error;
      terminalStatus = "conflict";
      continue;
    }

    const outcome = await executeChangedStep(context, runtime, before);
    if ("operationId" in outcome) {
      completedWriteCount += 1;
      steps.push(outcome);
      continue;
    }
    steps.push(terminalStep(runtime, outcome));
    stoppedAtIndex = index;
    causalError = outcome.error;
    terminalStatus = outcome.aggregateStatus ?? (outcome.status === "conflict" ? "conflict" : "failed");
  }

  const partialCompletion = completedWriteCount > 0 && stoppedAtIndex !== null;
  const partialWarning: Warning[] = partialCompletion ? [{
    kind: "partial_completion",
    message: "The plan stopped after one or more verified writes.",
    details: { completedWriteCount, stoppedAtIndex },
  }] : [];
  const warnings = deduplicateWarnings([
    ...steps.flatMap((step) => step.warnings),
    ...partialWarning,
  ]);
  const status: OperationStatus = stoppedAtIndex === null
    ? (completedWriteCount > 0 ? "updated" : "existing")
    : partialCompletion ? "failed" : (terminalStatus ?? "failed");
  const error = partialCompletion
    ? safeError(
      "partial_execution",
      "The plan stopped after a partial execution",
      null,
      { completedWriteCount, stoppedAtIndex },
    )
    : causalError;

  return createOperationResult({
    status,
    operation: OPERATION,
    requestId,
    data: resultData(
      plan,
      input.operations.length,
      steps,
      completedWriteCount,
      alreadySatisfiedCount,
      stoppedAtIndex,
    ),
    verified: stoppedAtIndex === null,
    warnings,
    journal: steps.map(journalForStep),
    error,
  });
}
