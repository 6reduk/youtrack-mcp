import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function processEnvironment(extra: Readonly<Record<string, string>>): Record<string, string> {
  const inherited = Object.entries(process.env)
    .filter((entry): entry is [string, string] => entry[1] !== undefined);
  return { ...Object.fromEntries(inherited), ...extra };
}

export async function withStdioClient<T>(
  env: Readonly<Record<string, string>>,
  run: (client: Client, transport: StdioClientTransport) => Promise<T>,
): Promise<T> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/cli.ts"],
    cwd: process.cwd(),
    env: processEnvironment(env),
    stderr: "pipe",
  });
  const client = new Client({ name: "youtrack-mcp-protocol-test", version: "1.0.0" });
  await client.connect(transport);
  try {
    return await run(client, transport);
  } finally {
    await client.close();
  }
}
