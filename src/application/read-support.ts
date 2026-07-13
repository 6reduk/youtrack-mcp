import type { ProjectSelector } from "../domain/identifiers.js";
import type { Candidate, OperationResult, PageInfo, SafeTarget } from "../domain/operation-result.js";
import { createOperationResult } from "../domain/operation-result.js";
import type { ProjectSummary } from "../domain/project-schema.js";
import type { Resolution } from "../domain/resolution.js";
import { resolveExact } from "../domain/resolution.js";
import type { PageSlice, ReadContext } from "./ports.js";

export function projectTarget(project: ProjectSummary): SafeTarget {
  return {
    kind: "project",
    id: project.id,
    name: project.name,
    url: project.url,
  };
}

export function projectCandidate(project: ProjectSummary): Candidate {
  return {
    kind: "project",
    id: project.id,
    name: project.name,
    url: project.url,
  };
}

export function pageInfo<T>(
  page: { readonly skip: number; readonly top: number },
  slice: PageSlice<T>,
  returned = slice.items.length,
): PageInfo {
  return {
    skip: page.skip,
    requestedTop: page.top,
    returned,
    hasMore: slice.hasMore,
  };
}

export async function resolveProject(
  context: ReadContext,
  selector: ProjectSelector,
): Promise<Resolution<ProjectSummary>> {
  const candidates = await context.gateway.findProjects(selector);
  return resolveExact<ProjectSummary, "id" | "shortName">({
    selector,
    candidates,
    accessors: {
      id: (project) => project.id,
      shortName: (project) => project.shortName,
    },
  });
}

export function projectResolutionFailure<T>(
  operation: string,
  requestId: string,
  resolution: Exclude<Resolution<ProjectSummary>, { readonly status: "resolved" }>,
): OperationResult<T> {
  if (resolution.status === "not_found") {
    return createOperationResult({
      status: "not_found",
      operation,
      requestId,
      error: {
        kind: "project_not_found",
        message: "No project exactly matched the supplied selector",
        httpStatus: null,
        retryable: false,
        details: {},
      },
    });
  }

  return createOperationResult({
    status: "ambiguous",
    operation,
    requestId,
    candidates: resolution.candidates.map(projectCandidate),
    error: {
      kind: "project_ambiguous",
      message: "More than one project exactly matched the supplied selector",
      httpStatus: null,
      retryable: false,
      details: {
        totalMatches: resolution.totalMatches,
        candidatesTruncated: resolution.truncated,
      },
    },
  });
}
