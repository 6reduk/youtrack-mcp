import type { ProjectSelector } from "../../domain/identifiers.js";
import type { OperationResult } from "../../domain/operation-result.js";
import { createOperationResult } from "../../domain/operation-result.js";
import type { ProjectSummary } from "../../domain/project-schema.js";
import { projectResolutionFailure, projectTarget, resolveProject } from "../read-support.js";
import type { ReadContext } from "../ports.js";

export async function getProject(
  context: ReadContext,
  project: ProjectSelector,
): Promise<OperationResult<ProjectSummary>> {
  const requestId = context.ids.nextId();
  const resolution = await resolveProject(context, project);
  if (resolution.status !== "resolved") {
    return projectResolutionFailure("youtrack_get_project", requestId, resolution);
  }

  return createOperationResult({
    status: "ok",
    operation: "youtrack_get_project",
    requestId,
    target: projectTarget(resolution.value),
    data: resolution.value,
  });
}
