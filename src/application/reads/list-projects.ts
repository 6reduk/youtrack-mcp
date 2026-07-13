import type { PageRequest } from "../../domain/identifiers.js";
import type { OperationResult } from "../../domain/operation-result.js";
import { createReadSuccess } from "../../domain/operation-result.js";
import type { ProjectSummary } from "../../domain/project-schema.js";
import { pageInfo } from "../read-support.js";
import type { ReadContext } from "../ports.js";

export interface ListProjectsInput {
  readonly page: PageRequest;
  readonly query?: string;
  readonly includeArchived?: boolean;
}

export async function listProjects(
  context: ReadContext,
  input: ListProjectsInput,
): Promise<OperationResult<{ readonly projects: readonly ProjectSummary[] }>> {
  const requestId = context.ids.nextId();
  const slice = await context.gateway.listProjects({
    page: input.page,
    includeArchived: input.includeArchived ?? true,
    ...(input.query === undefined ? {} : { query: input.query }),
  });
  return createReadSuccess(
    "youtrack_list_projects",
    requestId,
    { projects: slice.items },
    pageInfo(input.page, slice),
  );
}
