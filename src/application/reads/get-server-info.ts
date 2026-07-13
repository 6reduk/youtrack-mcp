import type { OperationResult } from "../../domain/operation-result.js";
import { createReadSuccess } from "../../domain/operation-result.js";
import type { ReadContext, ServerFacts } from "../ports.js";

export async function getServerInfo(context: ReadContext): Promise<OperationResult<ServerFacts>> {
  const requestId = context.ids.nextId();
  const facts = await context.gateway.getServerFacts();
  return createReadSuccess("youtrack_get_server_info", requestId, facts);
}
