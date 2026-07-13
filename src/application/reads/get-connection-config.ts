import type { OperationResult } from "../../domain/operation-result.js";
import { createReadSuccess } from "../../domain/operation-result.js";
import type { ConnectionConfigView, ReadContext } from "../ports.js";

export function getConnectionConfig(
  context: ReadContext,
): OperationResult<ConnectionConfigView> {
  return createReadSuccess(
    "youtrack_get_connection_config",
    context.ids.nextId(),
    context.connectionConfig.readConnectionConfig(),
  );
}
