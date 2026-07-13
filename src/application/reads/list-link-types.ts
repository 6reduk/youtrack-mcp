import type { PageRequest } from "../../domain/identifiers.js";
import type { LinkTypeDefinition } from "../../domain/links.js";
import type { OperationResult } from "../../domain/operation-result.js";
import { createReadSuccess } from "../../domain/operation-result.js";
import { pageInfo } from "../read-support.js";
import type { ReadContext } from "../ports.js";

export async function listLinkTypes(
  context: ReadContext,
  page: PageRequest,
): Promise<OperationResult<{ readonly linkTypes: readonly LinkTypeDefinition[] }>> {
  const requestId = context.ids.nextId();
  const slice = await context.gateway.listLinkTypes(page);
  return createReadSuccess(
    "youtrack_list_link_types",
    requestId,
    { linkTypes: slice.items },
    pageInfo(page, slice),
  );
}
