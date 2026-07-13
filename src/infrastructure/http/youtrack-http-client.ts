import type { LoggerPort } from "../../application/ports.js";
import type { RuntimeConfig } from "../config.js";
import { YouTrackHttpError, mapHttpStatus } from "./error-mapper.js";
import {
  DEFAULT_RETRY_POLICY,
  retryDelayMs,
  shouldRetryRead,
  type RetryPolicy,
} from "./retry-policy.js";

const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export type Sleep = (milliseconds: number) => Promise<void>;
export type FetchImplementation = typeof fetch;

export interface HttpClientOptions {
  readonly config: RuntimeConfig;
  readonly logger: LoggerPort;
  readonly fetch?: FetchImplementation;
  readonly sleep?: Sleep;
  readonly retryPolicy?: RetryPolicy;
  readonly maxResponseBytes?: number;
}

export interface JsonRequest {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly requestId: string;
  readonly body?: unknown;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class YouTrackHttpClient {
  readonly #baseUrl: URL;
  readonly #token: string;
  readonly #timeoutMs: number;
  readonly #logger: LoggerPort;
  readonly #fetch: FetchImplementation;
  readonly #sleep: Sleep;
  readonly #retryPolicy: RetryPolicy;
  readonly #maxResponseBytes: number;

  public constructor(options: HttpClientOptions) {
    this.#baseUrl = new URL(options.config.baseUrl.href);
    this.#token = options.config.token.reveal();
    this.#timeoutMs = options.config.requestTimeoutMs;
    this.#logger = options.logger;
    this.#fetch = options.fetch ?? fetch;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#retryPolicy = options.retryPolicy ?? DEFAULT_RETRY_POLICY;
    this.#maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  }

  public async getJson<T>(
    path: string,
    query: JsonRequest["query"],
    requestId: string,
  ): Promise<T> {
    let attempt = 1;
    for (;;) {
      try {
        return await this.requestJson<T>({
          method: "GET",
          path,
          requestId,
          ...(query === undefined ? {} : { query }),
        });
      } catch (error: unknown) {
        if (!shouldRetryRead(error, attempt, this.#retryPolicy)) {
          throw error;
        }
        const typed = error as YouTrackHttpError;
        const delay = retryDelayMs(typed, attempt, this.#retryPolicy);
        this.#logger.warn("Retrying safe YouTrack read", {
          requestId,
          attempt,
          delayMs: delay,
          kind: typed.kind,
        });
        await this.#sleep(delay);
        attempt += 1;
      }
    }
  }

  public async requestJson<T>(request: JsonRequest): Promise<T> {
    const url = this.buildUrl(request.path, request.query, request.requestId);
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${this.#token}`,
      "X-Request-ID": request.requestId,
    });
    let body: string | undefined;
    if (request.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(request.body);
    }

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: request.method,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(this.#timeoutMs),
        ...(body === undefined ? {} : { body }),
      });
    } catch (error: unknown) {
      const timeout = error instanceof Error && error.name === "TimeoutError";
      throw new YouTrackHttpError({
        kind: timeout ? "request_timeout" : "transport_error",
        message: timeout ? "YouTrack request timed out" : "YouTrack request failed before a response",
        status: null,
        retryable: request.method === "GET",
        requestId: request.requestId,
        cause: error,
      });
    }

    if (response.status >= 300 && response.status <= 399) {
      throw new YouTrackHttpError({
        kind: "redirect_rejected",
        message: "YouTrack redirect was rejected to protect the authorization boundary",
        status: response.status,
        retryable: false,
        requestId: request.requestId,
      });
    }
    if (!response.ok) {
      throw mapHttpStatus(response.status, request.requestId, response.headers.get("retry-after"));
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > this.#maxResponseBytes) {
      throw new YouTrackHttpError({
        kind: "response_too_large",
        message: "YouTrack response exceeded the configured safety limit",
        status: response.status,
        retryable: false,
        requestId: request.requestId,
      });
    }

    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > this.#maxResponseBytes) {
      throw new YouTrackHttpError({
        kind: "response_too_large",
        message: "YouTrack response exceeded the configured safety limit",
        status: response.status,
        retryable: false,
        requestId: request.requestId,
      });
    }
    if (text.length === 0) {
      return null as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch (error: unknown) {
      throw new YouTrackHttpError({
        kind: "invalid_json",
        message: "YouTrack returned malformed JSON",
        status: response.status,
        retryable: false,
        requestId: request.requestId,
        cause: error,
      });
    }
  }

  private buildUrl(
    path: string,
    query: JsonRequest["query"],
    requestId: string,
  ): URL {
    if (path.startsWith("/") || path.includes("..") || path.includes("://")) {
      throw new YouTrackHttpError({
        kind: "transport_error",
        message: "Internal YouTrack path was rejected",
        status: null,
        retryable: false,
        requestId,
      });
    }

    const url = new URL(`api/${path}`, this.#baseUrl);
    if (url.origin !== this.#baseUrl.origin) {
      throw new YouTrackHttpError({
        kind: "transport_error",
        message: "Internal YouTrack URL changed origin",
        status: null,
        retryable: false,
        requestId,
      });
    }
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    return url;
  }
}
