import type { IssueSelector, ProjectSelector } from "../../domain/identifiers.js";
import type { OperationResult, Warning } from "../../domain/operation-result.js";
import { createOperationResult } from "../../domain/operation-result.js";
import type { CompletenessEvidence, FieldDefinition, ProjectSchema, SchemaSourceKind } from "../../domain/project-schema.js";
import { projectResolutionFailure, projectTarget, resolveProject } from "../read-support.js";
import type { ReadContext, SchemaFragment } from "../ports.js";

export interface GetProjectSchemaInput {
  readonly project: ProjectSelector;
  readonly probeIssue?: IssueSelector;
  readonly includeAllowedValues?: boolean;
}

function mergeFields(fragments: readonly SchemaFragment[]): readonly FieldDefinition[] {
  const fields = new Map<string, FieldDefinition>();
  for (const fragment of fragments) {
    for (const incoming of fragment.fields) {
      const current = fields.get(incoming.id);
      if (current === undefined) {
        fields.set(incoming.id, incoming);
        continue;
      }

      const provenance = new Set<SchemaSourceKind>([
        ...current.provenance,
        ...incoming.provenance,
      ]);
      const values = new Map(current.allowedValues.map((value) => [value.id, value]));
      for (const value of incoming.allowedValues) {
        if (!values.has(value.id)) {
          values.set(value.id, value);
        }
      }

      fields.set(incoming.id, {
        ...current,
        valuesComplete: current.valuesComplete || incoming.valuesComplete,
        allowedValues: [...values.values()],
        provenance: [...provenance],
      });
    }
  }
  return [...fields.values()];
}

function schemaCompleteness(admin: SchemaFragment, probe: SchemaFragment | undefined): CompletenessEvidence {
  if (admin.schemaComplete) {
    return { status: "complete", reason: "authoritative_source_exhausted" };
  }
  if (probe !== undefined && probe.fields.length > 0) {
    return { status: "partial", reason: "fallback_source" };
  }
  if (admin.source.outcome === "empty") {
    return { status: "unavailable", reason: "source_empty" };
  }
  if (admin.source.outcome === "forbidden") {
    return { status: "unavailable", reason: "source_forbidden" };
  }
  return { status: "unavailable", reason: "source_unavailable" };
}

export async function getProjectSchema(
  context: ReadContext,
  input: GetProjectSchemaInput,
): Promise<OperationResult<ProjectSchema>> {
  const requestId = context.ids.nextId();
  const projectResolution = await resolveProject(context, input.project);
  if (projectResolution.status !== "resolved") {
    return projectResolutionFailure("youtrack_get_project_schema", requestId, projectResolution);
  }

  const project = projectResolution.value;
  const admin = await context.gateway.getAdminProjectSchema(project);
  const fragments: SchemaFragment[] = [admin];
  const warnings: Warning[] = [];

  if (admin.source.outcome === "empty") {
    warnings.push({
      kind: "admin_schema_empty",
      message: "The administrative project-field source returned no visible fields; this does not prove that the project has no custom fields",
    });
  }

  if (input.probeIssue !== undefined && !admin.schemaComplete) {
    const probe = await context.gateway.getProbeProjectSchema(input.probeIssue);
    if (probe === null) {
      return createOperationResult({
        status: "not_found",
        operation: "youtrack_get_project_schema",
        requestId,
        target: projectTarget(project),
        error: {
          kind: "probe_issue_not_found",
          message: "The explicitly supplied probe issue was not found",
          httpStatus: null,
          retryable: false,
          details: {},
        },
      });
    }
    if (probe.projectId !== project.id) {
      return createOperationResult({
        status: "invalid",
        operation: "youtrack_get_project_schema",
        requestId,
        target: projectTarget(project),
        error: {
          kind: "probe_project_mismatch",
          message: "The explicitly supplied probe issue belongs to a different project",
          httpStatus: null,
          retryable: false,
          details: { probeIssueId: probe.issueId },
        },
      });
    }
    fragments.push(probe);
    warnings.push({
      kind: "probe_schema_incomplete",
      message: "Probe issue metadata cannot prove that every project field is visible",
    });
  }

  if (!admin.schemaComplete) {
    warnings.push({
      kind: "schema_incomplete",
      message: "The available sources do not prove a complete project schema",
    });
  }

  const includeValues = input.includeAllowedValues ?? true;
  if (!includeValues) {
    warnings.push({
      kind: "allowed_values_omitted",
      message: "Allowed values were omitted by request, so response value lists are not complete",
    });
  }
  const schema: ProjectSchema = {
    project,
    schemaComplete: admin.schemaComplete,
    completeness: schemaCompleteness(admin, fragments[1]),
    sources: fragments.map((fragment) => fragment.source),
    fields: mergeFields(fragments).map((field) =>
      includeValues ? field : { ...field, valuesComplete: false, allowedValues: [] },
    ),
  };

  return createOperationResult({
    status: "ok",
    operation: "youtrack_get_project_schema",
    requestId,
    target: { ...projectTarget(project), kind: "schema" },
    data: schema,
    warnings,
  });
}
