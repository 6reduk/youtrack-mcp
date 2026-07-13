import type { SchemaFragment } from "../../application/ports.js";
import type { ProjectSummary } from "../../domain/project-schema.js";
import { YouTrackHttpError } from "../http/error-mapper.js";
import { PROJECT_FIELD_WITH_BUNDLE_FIELDS } from "../http/fields-projections.js";
import type { YouTrackHttpClient } from "../http/youtrack-http-client.js";
import type { AllowedValueDto, ProjectFieldDto } from "./dtos.js";
import { mapProjectField } from "./mappers.js";

const PAGE_SIZE = 100;

async function discoverAllowedValues(
  http: YouTrackHttpClient,
  project: ProjectSummary,
  field: ProjectFieldDto,
  requestId: string,
): Promise<{ readonly complete: boolean; readonly values: readonly AllowedValueDto[] }> {
  const valueType = typeof field.field?.fieldType?.valueType === "string"
    ? field.field.fieldType.valueType.toLowerCase()
    : null;
  const bundleId = typeof field.bundle === "object" && field.bundle !== null && "id" in field.bundle && typeof field.bundle.id === "string"
    ? field.bundle.id
    : null;
  if (bundleId === null) return { complete: valueType !== "user" && !["enum", "state", "version", "ownedfield", "build"].includes(valueType ?? ""), values: [] };
  const fieldId = typeof field.id === "string" ? field.id : null;
  if (fieldId === null) return { complete: false, values: [] };
  const path = valueType === "user"
    ? `admin/customFieldSettings/bundles/user/${encodeURIComponent(bundleId)}/aggregatedUsers`
    : `admin/projects/${encodeURIComponent(project.id)}/customFields/${encodeURIComponent(fieldId)}/bundle/values`;
  const values: AllowedValueDto[] = [];
  try {
    for (let skip = 0; ; skip += PAGE_SIZE) {
      const page = await http.getJson<AllowedValueDto[]>(path, {
        fields: valueType === "user" ? "id,login,name,fullName,banned,$type" : "id,name,localizedName,isResolved,$type",
        $skip: skip,
        $top: PAGE_SIZE,
      }, requestId);
      values.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
    return { complete: true, values };
  } catch (error: unknown) {
    if (error instanceof YouTrackHttpError && ["permission_denied", "upstream_not_found"].includes(error.kind)) {
      return { complete: false, values: field.bundle?.values ?? field.bundle?.aggregatedUsers ?? [] };
    }
    throw error;
  }
}

export async function discoverAdminSchema(
  http: YouTrackHttpClient,
  project: ProjectSummary,
  requestId: string,
): Promise<SchemaFragment> {
  const fields: ProjectFieldDto[] = [];
  try {
    for (let skip = 0; ; skip += PAGE_SIZE) {
      const page = await http.getJson<ProjectFieldDto[]>(
        `admin/projects/${encodeURIComponent(project.id)}/customFields`,
        { fields: PROJECT_FIELD_WITH_BUNDLE_FIELDS, $skip: skip, $top: PAGE_SIZE },
        requestId,
      );
      fields.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
  } catch (error: unknown) {
    if (error instanceof YouTrackHttpError && error.kind === "permission_denied") {
      return { source: { kind: "admin_project_fields", outcome: "forbidden" }, schemaComplete: false, fields: [] };
    }
    throw error;
  }
  const outcome = fields.length === 0 ? "empty" : "ok";
  const mapped = [];
  for (const field of fields) {
    const allowed = await discoverAllowedValues(http, project, field, requestId);
    mapped.push(mapProjectField(field, "admin_project_fields", allowed.complete, allowed.values));
  }
  return {
    source: { kind: "admin_project_fields", outcome },
    schemaComplete: fields.length > 0,
    fields: mapped,
  };
}
