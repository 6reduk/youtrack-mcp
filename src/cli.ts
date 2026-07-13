#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { ConfigError, loadRuntimeConfig } from "./infrastructure/config.js";
import { RedactingLogger } from "./infrastructure/logging/redacting-logger.js";

export function main(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): number {
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

    // MCP transport and tools are added in the approved read-only stages.
    return 0;
  } catch (error: unknown) {
    const message = error instanceof ConfigError ? error.message : "Unexpected startup failure";
    process.stderr.write(`youtrack-mcp: ${message}\n`);
    return 1;
  }
}

const isDirectExecution =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  process.exitCode = main();
}
