import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ConnectionConfigReader, IdGenerator, LoggerPort, ReadContext } from "../application/ports.js";
import type { RuntimeConfig } from "../infrastructure/config.js";
import { YouTrackHttpClient } from "../infrastructure/http/youtrack-http-client.js";
import { RestYouTrackGateway } from "../infrastructure/youtrack/gateway.js";
import { registerReadTools } from "./register-read-tools.js";
import { registerMutationTools } from "./register-mutation-tools.js";

class UuidGenerator implements IdGenerator {
  public nextId(): string { return randomUUID(); }
}

export function createReadContext(config: RuntimeConfig, logger: LoggerPort): ReadContext {
  const connectionConfig: ConnectionConfigReader = {
    readConnectionConfig: () => ({
      baseUrl: config.baseUrl.href,
      tokenConfigured: true,
      projectSelection: "explicit",
      defaultProject: null,
      requestTimeoutMs: config.requestTimeoutMs,
      logLevel: config.logLevel,
      insecureHttpAllowed: config.insecureHttpAllowed,
    }),
  };
  const http = new YouTrackHttpClient({ config, logger });
  return { gateway: new RestYouTrackGateway(http, config.baseUrl), connectionConfig, ids: new UuidGenerator(), logger };
}

export function createServer(context: ReadContext): McpServer {
  const server = new McpServer({ name: "youtrack-mcp", version: "0.1.2" });
  registerReadTools(server, context);
  registerMutationTools(server, context);
  return server;
}
