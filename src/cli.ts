#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { ConfigError, loadRuntimeConfig } from "./infrastructure/config.js";
import { RedactingLogger } from "./infrastructure/logging/redacting-logger.js";
import { createReadContext, createServer } from "./server/create-server.js";

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  if (argv.length > 0) {
    process.stderr.write("youtrack-mcp: CLI arguments are not supported; configure through environment\n");
    return 2;
  }

  try {
    const config = loadRuntimeConfig(env);
    const logger = new RedactingLogger({
      level: config.logLevel,
      secrets: [config.token.reveal()],
    });
    logger.debug("YouTrack MCP configuration validated", {
      baseUrl: config.baseUrl.origin,
      requestTimeoutMs: config.requestTimeoutMs,
    });

    const server = createServer(createReadContext(config, logger));
    await server.connect(new StdioServerTransport());
    return 0;
  } catch (error: unknown) {
    const message = error instanceof ConfigError ? error.message : "Unexpected startup failure";
    process.stderr.write(`youtrack-mcp: ${message}\n`);
    return 1;
  }
}

void main().then((code) => { process.exitCode = code; });
