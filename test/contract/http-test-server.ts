import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface CapturedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string;
}

export interface TestResponse {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export async function withHttpServer<T>(
  responder: (request: CapturedRequest, index: number) => TestResponse,
  run: (baseUrl: URL, requests: CapturedRequest[]) => Promise<T>,
): Promise<T> {
  const requests: CapturedRequest[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
    const captured: CapturedRequest = {
      method: request.method ?? "",
      url: request.url ?? "",
      headers: {
        authorization: request.headers.authorization,
        accept: request.headers.accept,
        contentType: request.headers["content-type"],
        requestId: request.headers["x-request-id"] as string | undefined,
      },
      body: Buffer.concat(chunks).toString("utf8"),
    };
    requests.push(captured);
    const result = responder(captured, requests.length - 1);
    response.writeHead(result.status ?? 200, {
      "content-type": "application/json",
      ...(result.headers ?? {}),
    });
      response.end(result.body ?? "null");
    })().catch(() => {
      response.destroy();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  try {
    return await run(new URL(`http://127.0.0.1:${String(address.port)}/tracker/`), requests);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  }
}
