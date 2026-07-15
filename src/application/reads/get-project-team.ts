import type { ProjectSelector, PageRequest } from "../../domain/identifiers.js";
import type { OperationResult } from "../../domain/operation-result.js";
import { createOperationResult } from "../../domain/operation-result.js";
import type { ProjectTeamSnapshot } from "../../domain/agile-audit.js";
import { projectResolutionFailure, projectTarget, resolveProject } from "../read-support.js";
import type { ReadContext } from "../ports.js";

export async function getProjectTeam(context: ReadContext, project: ProjectSelector, page: PageRequest): Promise<OperationResult<ProjectTeamSnapshot>> {
  const requestId = context.ids.nextId();
  const resolution = await resolveProject(context, project);
  if (resolution.status !== "resolved") return projectResolutionFailure("youtrack_get_project_team", requestId, resolution);
  const data = await context.gateway.getProjectTeam({ project: resolution.value, page });
  return createOperationResult({ status: "ok", operation: "youtrack_get_project_team", requestId, target: projectTarget(resolution.value), data,
    warnings: data.warnings.map((message) => ({ kind: "partial_team_data", message })) });
}
