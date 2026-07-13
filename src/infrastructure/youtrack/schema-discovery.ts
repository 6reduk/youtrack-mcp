import type { SchemaFragment } from "../../application/ports.js";
import type { ProjectSummary } from "../../domain/project-schema.js";
import { YouTrackHttpError } from "../http/error-mapper.js";
import { PROJECT_FIELD_WITH_BUNDLE_FIELDS } from "../http/fields-projections.js";
import type { YouTrackHttpClient } from "../http/youtrack-http-client.js";
import type { ProjectFieldDto } from "./dtos.js";
import { mapProjectField } from "./mappers.js";

const PAGE_SIZE = 100;

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
  return {
    source: { kind: "admin_project_fields", outcome },
    schemaComplete: fields.length > 0,
    fields: fields.map((field) => mapProjectField(field, "admin_project_fields", false)),
  };
}
