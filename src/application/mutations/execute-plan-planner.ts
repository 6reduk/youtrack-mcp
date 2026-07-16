import type { CustomFieldChange, FieldAtom, FieldValue } from "../../domain/field-values.js";
import {
  EXECUTE_PLAN_MAX_CUSTOM_FIELD_CHANGES,
  EXECUTE_PLAN_MAX_MULTI_VALUES,
  EXECUTE_PLAN_MAX_OPERATION_ID_LENGTH,
  EXECUTE_PLAN_MAX_OPERATIONS,
  EXECUTE_PLAN_MAX_WRITES,
  EXECUTE_PLAN_VERSION,
  hashResolvedPlan,
  type ExecutePlanInputKind,
  type ExecutePlanStepResult,
  type ResolvedIssueLinkV1,
  type ResolvedOperationV1,
  type ResolvedPlanV1,
  type ResolvedTagMembershipV1,
  type ResolvedUpdateIssueV1,
} from "../../domain/execute-plan.js";
import {
  DomainValidationError,
  type EntitySelector,
  type FieldSelector,
  type IssueSelector,
  type LinkDirection,
  type LinkTypeSelector,
  type TagSelector,
  type UserSelector,
} from "../../domain/identifiers.js";
import type { IssueSection, IssueSnapshot } from "../../domain/issue.js";
import type { OperationStatus, SafeError, SafeTarget, Warning } from "../../domain/operation-result.js";
import { YouTrackHttpError } from "../../infrastructure/http/error-mapper.js";
import type { MutationContext, UpdateIssueCommand } from "../ports.js";
import {
  assertLinkWouldNotCreateCycle,
  hasIssueRelation,
  resolveLinkTypeExact,
} from "./links.js";
import {
  loadMutationSchemaEvidence,
  planIssueUpdate,
  readIssueExact,
  resolveFieldFromEvidence,
  type IssueUpdateChanges,
} from "./support.js";
import { hasTag, resolveTagExact } from "./tags.js";

interface PlanOperationBase {
  readonly operationId?: string;
  readonly expectedUpdatedAt: number;
}

export interface UpdateIssuePlanOperation extends PlanOperationBase, IssueUpdateChanges {
  readonly kind: "update_issue";
  readonly issue: IssueSelector;
}

export interface SetCustomFieldPlanOperation extends PlanOperationBase {
  readonly kind: "set_custom_field";
  readonly issue: IssueSelector;
  readonly change: CustomFieldChange;
}

export interface SetIssueStatePlanOperation extends PlanOperationBase {
  readonly kind: "set_issue_state";
  readonly issue: IssueSelector;
  readonly field: FieldSelector;
  readonly value: EntitySelector;
}

export type SetAssigneePlanOperation = PlanOperationBase & {
  readonly kind: "set_assignee";
  readonly issue: IssueSelector;
  readonly field: FieldSelector;
} & (
  | { readonly action: "set"; readonly user: UserSelector }
  | { readonly action: "clear" }
);

export interface AddTagPlanOperation extends PlanOperationBase {
  readonly kind: "add_tag";
  readonly issue: IssueSelector;
  readonly tag: TagSelector;
}

export interface RemoveTagPlanOperation extends PlanOperationBase {
  readonly kind: "remove_tag";
  readonly issue: IssueSelector;
  readonly tag: TagSelector;
}

export interface AddLinkPlanOperation extends PlanOperationBase {
  readonly kind: "add_link";
  readonly source: IssueSelector;
  readonly target: IssueSelector;
  readonly linkType: LinkTypeSelector;
  readonly direction: LinkDirection;
  readonly preventCycle?: boolean;
}

export interface RemoveLinkPlanOperation extends PlanOperationBase {
  readonly kind: "remove_link";
  readonly source: IssueSelector;
  readonly target: IssueSelector;
  readonly linkType: LinkTypeSelector;
  readonly direction: LinkDirection;
  readonly expectedExisting: true;
}

export type PlanOperation =
  | UpdateIssuePlanOperation
  | SetCustomFieldPlanOperation
  | SetIssueStatePlanOperation
  | SetAssigneePlanOperation
  | AddTagPlanOperation
  | RemoveTagPlanOperation
  | AddLinkPlanOperation
  | RemoveLinkPlanOperation;

export interface PreviewExecutePlanInput {
  readonly dryRun: true;
  readonly confirm?: false;
  readonly operations: readonly PlanOperation[];
}

export interface ConfirmedExecutePlanInput {
  readonly dryRun: false;
  readonly confirm: true;
  readonly planHash: string;
  readonly operations: readonly PlanOperation[];
}

export type ExecutePlanInput = PreviewExecutePlanInput | ConfirmedExecutePlanInput;

export type PlannedWrite =
  | { readonly kind: "update_issue"; readonly command: UpdateIssueCommand }
  | { readonly kind: "tag_membership"; readonly tagId: string; readonly desiredPresent: boolean }
  | {
    readonly kind: "issue_link";
    readonly targetIssueId: string;
    readonly linkTypeId: string;
    readonly direction: LinkDirection;
    readonly desiredPresent: boolean;
    readonly preventCycle: boolean;
  };

export interface PlannedExecutePlanOperation {
  readonly canonical: ResolvedOperationV1;
  readonly target: SafeTarget;
  readonly warnings: readonly Warning[];
  readonly preflightSnapshot: IssueSnapshot;
  readonly sections: readonly IssueSection[];
  readonly write: PlannedWrite;
  readonly isSatisfied: (snapshot: IssueSnapshot) => boolean;
}

export interface PlannedExecutePlan {
  readonly resolvedPlan: ResolvedPlanV1;
  readonly planHash: string;
  readonly operations: readonly PlannedExecutePlanOperation[];
}

export interface ExecutePlanPlanningFailure {
  readonly index: number;
  readonly status: OperationStatus;
  readonly error: SafeError;
  readonly requestId: string | null;
  readonly operations: readonly ExecutePlanStepResult[];
}

export type ExecutePlanPlanningResult =
  | { readonly ok: true; readonly plan: PlannedExecutePlan }
  | { readonly ok: false; readonly failure: ExecutePlanPlanningFailure };

const UPDATE_ISSUE_SECTIONS = ["system", "description", "customFields", "users"] as const;
const SYSTEM_ISSUE_SECTIONS = ["system"] as const;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

function safeTarget(issue: IssueSnapshot): SafeTarget {
  return { kind: "issue", id: issue.id, idReadable: issue.idReadable, url: issue.url };
}

async function readIssueForPlan(
  context: MutationContext,
  selector: IssueSelector,
  sections: readonly IssueSection[],
): Promise<IssueSnapshot> {
  const issue = await context.gateway.getIssue(selector, sections);
  if (issue === null) throw new DomainValidationError("issue_not_found");
  return issue;
}

/** Reads the mutation subject with bounded collection evidence required by its primitive. */
export async function readPlannedOperationSnapshot(
  context: MutationContext,
  runtime: PlannedExecutePlanOperation,
): Promise<IssueSnapshot> {
  const selector = { id: runtime.canonical.subjectIssueId } as const;
  const snapshot = await readIssueForPlan(context, selector, runtime.sections);
  if (runtime.write.kind === "tag_membership") {
    const tags = await context.gateway.listIssueTags(selector, { skip: 0, top: 100 });
    if (tags.hasMore) throw new DomainValidationError("tags_incomplete");
    return { ...snapshot, tags: tags.items };
  }
  if (runtime.write.kind === "issue_link") {
    const links = await context.gateway.listIssueLinks(selector, { skip: 0, top: 100 });
    if (links.hasMore) throw new DomainValidationError("links_incomplete");
    return { ...snapshot, links: links.items };
  }
  return snapshot;
}

function errorKindFromDomain(error: DomainValidationError): string {
  const token = /^([a-z][a-z0-9_]*)(?::|$)/.exec(error.message)?.[1];
  return token ?? "invalid_input";
}

export function mapExecutePlanError(error: unknown): {
  readonly status: OperationStatus;
  readonly error: SafeError;
  readonly requestId: string | null;
} {
  if (error instanceof YouTrackHttpError) {
    return {
      status: error.kind === "permission_denied"
        ? "forbidden"
        : error.kind === "upstream_not_found" ? "not_found" : "failed",
      error: {
        kind: error.kind,
        message: error.message,
        httpStatus: error.status,
        retryable: error.retryable,
        details: {},
      },
      requestId: error.requestId,
    };
  }
  if (error instanceof DomainValidationError || error instanceof TypeError) {
    const kind = error instanceof DomainValidationError ? errorKindFromDomain(error) : "invalid_input";
    const notFound = kind.endsWith("_not_found");
    const ambiguous = kind.endsWith("_ambiguous");
    const conflict = kind === "updated_at_unavailable" || kind === "updated_at_mismatch";
    return {
      status: conflict ? "conflict" : notFound ? "not_found" : ambiguous ? "ambiguous" : "invalid",
      error: {
        kind,
        message: error.message,
        httpStatus: null,
        retryable: false,
        details: {},
      },
      requestId: null,
    };
  }
  return {
    status: "failed",
    error: {
      kind: "unexpected_error",
      message: "The operation failed safely",
      httpStatus: null,
      retryable: false,
      details: {},
    },
    requestId: null,
  };
}

function assertAtom(atom: FieldAtom): void {
  switch (atom.kind) {
    case "scalar":
      if (typeof atom.value === "number" && !Number.isFinite(atom.value)) {
        throw new DomainValidationError("invalid_number");
      }
      return;
    case "date":
      if (!Number.isSafeInteger(atom.epochMillis)) throw new DomainValidationError("invalid_date");
      return;
    case "period":
      if (!/^P(?!$)/.test(atom.iso8601)) throw new DomainValidationError("invalid_period");
      return;
    case "entity":
    case "user":
      return;
  }
}

function assertFieldValue(value: FieldValue): void {
  if (value.kind !== "multi") {
    assertAtom(value);
    return;
  }
  if (value.values.length > EXECUTE_PLAN_MAX_MULTI_VALUES) {
    throw new DomainValidationError("too_many_values");
  }
  for (const atom of value.values) assertAtom(atom);
}

function assertFieldChange(change: CustomFieldChange): void {
  if (change.action === "set") assertFieldValue(change.value);
}

function assertLocalOperation(operation: PlanOperation): void {
  if (!Number.isSafeInteger(operation.expectedUpdatedAt) || operation.expectedUpdatedAt < 0) {
    throw new DomainValidationError("invalid_expected_updated_at");
  }
  if (operation.operationId !== undefined && (
    operation.operationId.length === 0
    || operation.operationId.length > EXECUTE_PLAN_MAX_OPERATION_ID_LENGTH
    || operation.operationId.trim() !== operation.operationId
    || !OPERATION_ID_PATTERN.test(operation.operationId)
  )) {
    throw new DomainValidationError("invalid_operation_id");
  }
  switch (operation.kind) {
    case "update_issue": {
      const fields = operation.customFields ?? [];
      if (operation.summary === undefined && operation.description === undefined && fields.length === 0) {
        throw new DomainValidationError("at_least_one_change_required");
      }
      if (fields.length > EXECUTE_PLAN_MAX_CUSTOM_FIELD_CHANGES) {
        throw new DomainValidationError("too_many_custom_field_changes");
      }
      for (const change of fields) assertFieldChange(change);
      return;
    }
    case "set_custom_field":
      assertFieldChange(operation.change);
      return;
    case "set_issue_state":
    case "set_assignee":
    case "add_tag":
    case "remove_tag":
    case "add_link":
      return;
    case "remove_link":
      if ((operation as { readonly expectedExisting?: boolean }).expectedExisting !== true) {
        throw new DomainValidationError("expected_existing_required");
      }
      return;
  }
}

function stepFromInput(operation: PlanOperation, index: number): ExecutePlanStepResult {
  return {
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
  };
}

function failureResult(
  operations: readonly PlanOperation[],
  index: number,
  error: unknown,
  planned: readonly PlannedExecutePlanOperation[],
): ExecutePlanPlanningResult {
  const mapped = mapExecutePlanError(error);
  const steps = operations.map(stepFromInput);
  for (let cursor = 0; cursor < planned.length; cursor += 1) {
    const runtime = planned[cursor];
    const step = steps[cursor];
    if (runtime !== undefined && step !== undefined) {
      steps[cursor] = {
        ...step,
        target: runtime.target,
        status: "planned",
        alreadySatisfied: runtime.isSatisfied(runtime.preflightSnapshot),
        warnings: runtime.warnings,
      };
    }
  }
  const failed = steps[index];
  if (failed !== undefined) {
    steps[index] = {
      ...failed,
      status: mapped.status === "conflict" ? "conflict" : "failed",
      verified: false,
      error: mapped.error,
      requestId: mapped.requestId,
    };
  }
  return {
    ok: false,
    failure: {
      index,
      status: mapped.status,
      error: mapped.error,
      requestId: mapped.requestId,
      operations: steps,
    },
  };
}

function assertFreshOrSatisfied(
  runtime: PlannedExecutePlanOperation,
  snapshot: IssueSnapshot,
): void {
  if (runtime.isSatisfied(snapshot)) return;
  if (snapshot.updatedAt === null) throw new DomainValidationError("updated_at_unavailable");
  if (snapshot.updatedAt !== runtime.canonical.expectedUpdatedAt) {
    throw new DomainValidationError("updated_at_mismatch");
  }
}

async function planUpdateOperation(
  context: MutationContext,
  operation: UpdateIssuePlanOperation | SetCustomFieldPlanOperation | SetIssueStatePlanOperation | SetAssigneePlanOperation,
  index: number,
): Promise<PlannedExecutePlanOperation> {
  const issue = await readIssueExact(context, operation.issue);
  let changes: IssueUpdateChanges;
  let preloadedEvidence: Awaited<ReturnType<typeof loadMutationSchemaEvidence>> | undefined;

  switch (operation.kind) {
    case "update_issue":
      changes = {
        ...(operation.summary === undefined ? {} : { summary: operation.summary }),
        ...(operation.description === undefined ? {} : { description: operation.description }),
        ...(operation.customFields === undefined ? {} : { customFields: operation.customFields }),
      };
      break;
    case "set_custom_field":
      changes = { customFields: [operation.change] };
      break;
    case "set_issue_state": {
      preloadedEvidence = await loadMutationSchemaEvidence(context, issue.project, {
        purpose: "existing_issue",
        probeIssue: { id: issue.id },
      });
      const field = resolveFieldFromEvidence(preloadedEvidence, operation.field);
      if (field.valueType?.toLowerCase() !== "state" || field.cardinality !== "single") {
        throw new DomainValidationError("field_not_state_compatible");
      }
      changes = {
        customFields: [{
          field: { id: field.id },
          action: "set",
          value: { kind: "entity", selector: operation.value },
        }],
      };
      break;
    }
    case "set_assignee": {
      preloadedEvidence = await loadMutationSchemaEvidence(context, issue.project, {
        purpose: "existing_issue",
        probeIssue: { id: issue.id },
      });
      const field = resolveFieldFromEvidence(preloadedEvidence, operation.field);
      if (field.valueType?.toLowerCase() !== "user" || field.cardinality !== "single") {
        throw new DomainValidationError("field_not_single_user");
      }
      changes = operation.action === "clear"
        ? { customFields: [{ field: { id: field.id }, action: "clear" }] }
        : { customFields: [{
          field: { id: field.id },
          action: "set",
          value: { kind: "user", selector: operation.user },
        }] };
      break;
    }
  }

  const update = await planIssueUpdate(context, issue, changes, preloadedEvidence);
  const canonical: ResolvedUpdateIssueV1 = {
    index,
    operationId: operation.operationId ?? null,
    inputKind: operation.kind,
    kind: "update_issue",
    subjectIssueId: issue.id,
    expectedUpdatedAt: operation.expectedUpdatedAt,
    command: update.canonicalCommand,
    postconditions: update.canonicalPostconditions,
  };
  return {
    canonical,
    target: safeTarget(issue),
    warnings: update.warnings,
    preflightSnapshot: issue,
    sections: UPDATE_ISSUE_SECTIONS,
    write: { kind: "update_issue", command: update.command },
    isSatisfied: update.isSatisfied,
  };
}

async function planTagOperation(
  context: MutationContext,
  operation: AddTagPlanOperation | RemoveTagPlanOperation,
  index: number,
): Promise<PlannedExecutePlanOperation> {
  const issueBase = await readIssueForPlan(context, operation.issue, SYSTEM_ISSUE_SECTIONS);
  const issueTags = await context.gateway.listIssueTags({ id: issueBase.id }, { skip: 0, top: 100 });
  if (issueTags.hasMore) throw new DomainValidationError("tags_incomplete");
  const issue = { ...issueBase, tags: issueTags.items };
  const tag = await resolveTagExact(context, operation.tag);
  const desiredPresent = operation.kind === "add_tag";
  const canonical: ResolvedTagMembershipV1 = {
    index,
    operationId: operation.operationId ?? null,
    inputKind: operation.kind,
    kind: "tag_membership",
    subjectIssueId: issue.id,
    expectedUpdatedAt: operation.expectedUpdatedAt,
    tagId: tag.id,
    desiredPresent,
  };
  return {
    canonical,
    target: safeTarget(issue),
    warnings: [],
    preflightSnapshot: issue,
    sections: SYSTEM_ISSUE_SECTIONS,
    write: { kind: "tag_membership", tagId: tag.id, desiredPresent },
    isSatisfied: (snapshot) => hasTag(snapshot, tag.id) === desiredPresent,
  };
}

async function planLinkOperation(
  context: MutationContext,
  operation: AddLinkPlanOperation | RemoveLinkPlanOperation,
  index: number,
): Promise<PlannedExecutePlanOperation> {
  const sourceBase = await readIssueForPlan(context, operation.source, SYSTEM_ISSUE_SECTIONS);
  const sourceLinks = await context.gateway.listIssueLinks({ id: sourceBase.id }, { skip: 0, top: 100 });
  if (sourceLinks.hasMore) throw new DomainValidationError("links_incomplete");
  const source = { ...sourceBase, links: sourceLinks.items };
  const target = await readIssueForPlan(context, operation.target, SYSTEM_ISSUE_SECTIONS);
  if (source.id === target.id) throw new DomainValidationError("self_link_invalid");
  const linkType = await resolveLinkTypeExact(context, operation.linkType);
  const desiredPresent = operation.kind === "add_link";
  const preventCycle = operation.kind === "add_link" ? (operation.preventCycle ?? false) : false;
  const canonical: ResolvedIssueLinkV1 = {
    index,
    operationId: operation.operationId ?? null,
    inputKind: operation.kind,
    kind: "issue_link",
    subjectIssueId: source.id,
    expectedUpdatedAt: operation.expectedUpdatedAt,
    targetIssueId: target.id,
    linkTypeId: linkType.id,
    direction: operation.direction,
    desiredPresent,
    preventCycle,
  };
  const runtime: PlannedExecutePlanOperation = {
    canonical,
    target: safeTarget(source),
    warnings: [],
    preflightSnapshot: source,
    sections: SYSTEM_ISSUE_SECTIONS,
    write: {
      kind: "issue_link",
      targetIssueId: target.id,
      linkTypeId: linkType.id,
      direction: operation.direction,
      desiredPresent,
      preventCycle,
    },
    isSatisfied: (snapshot) => hasIssueRelation(
      snapshot,
      target.id,
      linkType.id,
      operation.direction,
    ) === desiredPresent,
  };
  if (!runtime.isSatisfied(source) && preventCycle) {
    await assertLinkWouldNotCreateCycle(
      context,
      source.id,
      target.id,
      linkType.id,
      operation.direction,
    );
  }
  return runtime;
}

async function planOperation(
  context: MutationContext,
  operation: PlanOperation,
  index: number,
): Promise<PlannedExecutePlanOperation> {
  switch (operation.kind) {
    case "update_issue":
    case "set_custom_field":
    case "set_issue_state":
    case "set_assignee":
      return planUpdateOperation(context, operation, index);
    case "add_tag":
    case "remove_tag":
      return planTagOperation(context, operation, index);
    case "add_link":
    case "remove_link":
      return planLinkOperation(context, operation, index);
  }
}

/** Performs the complete GET-only preflight and creates the canonical hash. */
export async function planExecutePlan(
  context: MutationContext,
  operations: readonly PlanOperation[],
): Promise<ExecutePlanPlanningResult> {
  if (operations.length === 0 || operations.length > EXECUTE_PLAN_MAX_OPERATIONS) {
    const index = operations.length > EXECUTE_PLAN_MAX_OPERATIONS
      ? EXECUTE_PLAN_MAX_OPERATIONS
      : 0;
    return failureResult(
      operations,
      Math.min(index, Math.max(0, operations.length - 1)),
      new DomainValidationError(operations.length === 0 ? "at_least_one_operation_required" : "too_many_operations"),
      [],
    );
  }

  const operationIds = new Set<string>();
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    if (operation === undefined) continue;
    try {
      assertLocalOperation(operation);
      if (operation.operationId !== undefined) {
        if (operationIds.has(operation.operationId)) {
          throw new DomainValidationError("duplicate_operation_id");
        }
        operationIds.add(operation.operationId);
      }
    } catch (error: unknown) {
      return failureResult(operations, index, error, []);
    }
  }

  const planned: PlannedExecutePlanOperation[] = [];
  const subjectIds = new Set<string>();
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    if (operation === undefined) continue;
    try {
      const runtime = await planOperation(context, operation, index);
      if (subjectIds.has(runtime.canonical.subjectIssueId)) {
        throw new DomainValidationError("duplicate_mutation_subject");
      }
      subjectIds.add(runtime.canonical.subjectIssueId);
      assertFreshOrSatisfied(runtime, runtime.preflightSnapshot);
      planned.push(runtime);
    } catch (error: unknown) {
      return failureResult(operations, index, error, planned);
    }
  }

  if (planned.length > EXECUTE_PLAN_MAX_WRITES) {
    return failureResult(
      operations,
      operations.length - 1,
      new DomainValidationError("write_limit_exceeded"),
      planned,
    );
  }
  const resolvedPlan: ResolvedPlanV1 = {
    version: EXECUTE_PLAN_VERSION,
    operations: planned.map((operation) => operation.canonical),
  };
  return {
    ok: true,
    plan: {
      resolvedPlan,
      planHash: hashResolvedPlan(resolvedPlan),
      operations: planned,
    },
  };
}

export type { ExecutePlanInputKind };
