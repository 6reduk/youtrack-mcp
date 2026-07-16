import type { CustomFieldChange } from "../../domain/field-values.js";
import { DomainValidationError, type IssueSelector, type ProjectSelector } from "../../domain/identifiers.js";
import { createOperationResult, type OperationResult } from "../../domain/operation-result.js";
import { verifyPostconditions, type Postcondition } from "../../domain/verification.js";
import type { IssueSnapshot } from "../../domain/issue.js";
import { YouTrackHttpError } from "../../infrastructure/http/error-mapper.js";
import type { MutationContext, SerializedCustomFieldChange } from "../ports.js";
import type { MutationPlan } from "../mutation-runner.js";
import { fieldValueEquals, loadMutationSchemaEvidence, observedField, resolveFieldFromEvidence, resolveProjectExact, serializeChange } from "./support.js";

export interface CreateIssueInput {
  readonly project: ProjectSelector;
  readonly summary: string;
  readonly description: string;
  readonly customFields?: readonly CustomFieldChange[];
  readonly probeIssue?: IssueSelector;
  readonly dryRun?: boolean;
}

export async function createIssue(
  context: MutationContext,
  input: CreateIssueInput,
): Promise<OperationResult<{ readonly plan: MutationPlan }>> {
  const requestId = context.ids.nextId();
  if (input.summary.trim().length === 0 || input.summary.length > 1_000) throw new DomainValidationError("invalid_summary");
  if (input.description.length > 100_000) throw new DomainValidationError("description_too_large");
  const project = await resolveProjectExact(context, input.project);
  const changes = input.customFields ?? [];
  const evidence = await loadMutationSchemaEvidence(context, project, {
    purpose: "create",
    fieldsRequired: changes.length > 0,
    ...(input.probeIssue === undefined ? {} : { probeIssue: input.probeIssue }),
  });
  const serialized: SerializedCustomFieldChange[] = [];
  const warnings = [...evidence.warnings];
  const conditions: Postcondition<IssueSnapshot, unknown>[] = [
    { name: "summary", expected: input.summary, observe: (issue) => issue.summary },
    { name: "description", expected: input.description, observe: (issue) => issue.description },
  ];
  const supplied = new Set<string>();
  for (const change of changes) {
    if (change.action !== "set") throw new DomainValidationError("create_fields_must_use_set");
    const field = resolveFieldFromEvidence(evidence, change.field);
    if (supplied.has(field.id)) throw new DomainValidationError("duplicate_field_change");
    supplied.add(field.id);
    const encoded = await serializeChange(context, field, change, evidence);
    serialized.push(encoded.serialized);
    warnings.push(...encoded.warnings);
    conditions.push({ name: `customField:${field.id}`, expected: encoded.expected, observe: (issue) => observedField(issue, field.id), equals: fieldValueEquals });
  }
  if (evidence.mode === "complete") {
    const missingRequired = evidence.fields.filter((field) =>
      field.required === true && field.hasDefaultValue === false && !supplied.has(field.id));
    if (missingRequired.length > 0) throw new DomainValidationError("required_custom_fields_missing");
  }
  const plan: MutationPlan = {
    target: project.shortName,
    changes: conditions.map((condition) => condition.name),
    writeCount: 1,
  };
  if (input.dryRun === true) {
    return createOperationResult({
      status: "ok", operation: "youtrack_create_issue", requestId,
      target: { kind: "project", id: project.id, name: project.name, url: project.url },
      data: { plan }, warnings,
      journal: [{ name: "create_issue", status: "planned", verified: null }],
    });
  }
  let receipt;
  try {
    receipt = await context.gateway.createIssue({
      projectId: project.id, summary: input.summary, description: input.description, customFields: serialized,
    });
  } catch (error: unknown) {
    if (error instanceof YouTrackHttpError && (error.kind === "request_timeout" || error.kind === "transport_error")) {
      return createOperationResult({
        status: "failed", operation: "youtrack_create_issue", requestId,
        target: { kind: "project", id: project.id, name: project.name, url: project.url },
        data: { plan }, verified: false, warnings,
        journal: [{ name: "create_issue", status: "unknown", verified: false }],
        error: {
          kind: "uncertain_write",
          message: "The create request outcome is unknown and cannot be reconciled without a returned issue ID",
          httpStatus: error.status,
          retryable: false,
          details: {},
        },
      });
    }
    throw error;
  }
  if (receipt.issueId.length === 0) throw new DomainValidationError("create_response_missing_issue_id");
  const after = await context.gateway.getIssue({ id: receipt.issueId }, ["system", "description", "customFields", "users"]);
  if (after === null) {
    return createOperationResult({
      status: "failed", operation: "youtrack_create_issue", requestId,
      data: { plan }, verified: false, warnings,
      error: { kind: "post_read_missing", message: "Created issue was not readable for verification", httpStatus: null, retryable: false, details: {} },
    });
  }
  const verification = verifyPostconditions(after, conditions);
  return createOperationResult({
    status: verification.verified ? "created" : "failed",
    operation: "youtrack_create_issue", requestId,
    target: { kind: "issue", id: after.id, idReadable: after.idReadable, url: after.url },
    data: { plan }, after, verified: verification.verified, warnings,
    journal: [{ name: "create_issue", status: "completed", verified: verification.verified }],
    ...(verification.verified ? {} : {
      error: { kind: "postcondition_mismatch", message: "Created issue did not match every requested value", httpStatus: null, retryable: false, details: { mismatchCount: verification.mismatches.length } },
    }),
  });
}
