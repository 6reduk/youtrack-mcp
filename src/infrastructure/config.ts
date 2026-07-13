import { inspect } from "node:util";

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const MIN_REQUEST_TIMEOUT_MS = 1_000;
export const MAX_REQUEST_TIMEOUT_MS = 120_000;

export const LOG_LEVELS = ["error", "warn", "info", "debug"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const INSPECT = Symbol.for("nodejs.util.inspect.custom");

export class ConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export class SecretValue {
  readonly #value: string;

  public constructor(value: string) {
    this.#value = value;
    Object.freeze(this);
  }

  public reveal(): string {
    return this.#value;
  }

  public toJSON(): string {
    return "[REDACTED]";
  }

  public toString(): string {
    return "[REDACTED]";
  }

  public [INSPECT](): string {
    return "SecretValue([REDACTED])";
  }
}

export interface RuntimeConfig {
  readonly baseUrl: URL;
  readonly token: SecretValue;
  readonly requestTimeoutMs: number;
  readonly logLevel: LogLevel;
  readonly insecureHttpAllowed: boolean;
}

function requireNonEmpty(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new ConfigError(`${name} is required and must be non-empty`);
  }

  return value;
}

function parseBoolean(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = env[name]?.trim().toLowerCase();
  if (value === undefined || value.length === 0 || value === "false") {
    return false;
  }
  if (value === "true") {
    return true;
  }

  throw new ConfigError(`${name} must be either true or false`);
}

function parseTimeout(env: NodeJS.ProcessEnv): number {
  const raw = env.YOUTRACK_REQUEST_TIMEOUT_MS?.trim();
  if (raw === undefined || raw.length === 0) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  if (!/^\d+$/.test(raw)) {
    throw new ConfigError("YOUTRACK_REQUEST_TIMEOUT_MS must be an integer");
  }

  const value = Number(raw);
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_REQUEST_TIMEOUT_MS ||
    value > MAX_REQUEST_TIMEOUT_MS
  ) {
    throw new ConfigError(
      `YOUTRACK_REQUEST_TIMEOUT_MS must be between ${String(MIN_REQUEST_TIMEOUT_MS)} and ${String(MAX_REQUEST_TIMEOUT_MS)}`,
    );
  }

  return value;
}

function parseLogLevel(env: NodeJS.ProcessEnv): LogLevel {
  const value = env.YOUTRACK_LOG_LEVEL?.trim().toLowerCase() ?? "info";
  if ((LOG_LEVELS as readonly string[]).includes(value)) {
    return value as LogLevel;
  }

  throw new ConfigError(`YOUTRACK_LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}`);
}

function parseBaseUrl(raw: string, insecureHttpAllowed: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError("YOUTRACK_URL must be a valid absolute URL");
  }

  if (url.username.length > 0 || url.password.length > 0) {
    throw new ConfigError("YOUTRACK_URL must not contain credentials");
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new ConfigError("YOUTRACK_URL must not contain a query string or fragment");
  }

  if (url.protocol !== "https:") {
    const loopbackHttp =
      url.protocol === "http:" && insecureHttpAllowed && LOOPBACK_HOSTS.has(url.hostname);
    if (!loopbackHttp) {
      throw new ConfigError(
        "YOUTRACK_URL must use HTTPS; HTTP is allowed only for an explicitly enabled loopback test server",
      );
    }
  }

  const normalizedPath = url.pathname.replace(/\/+$/, "").replace(/\/api$/i, "");
  url.pathname = normalizedPath.length === 0 ? "/" : `${normalizedPath}/`;
  return url;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const insecureHttpAllowed = parseBoolean(env, "YOUTRACK_ALLOW_INSECURE_HTTP");
  const baseUrl = parseBaseUrl(requireNonEmpty(env, "YOUTRACK_URL"), insecureHttpAllowed);
  const token = new SecretValue(requireNonEmpty(env, "YOUTRACK_TOKEN"));

  return Object.freeze({
    baseUrl,
    token,
    requestTimeoutMs: parseTimeout(env),
    logLevel: parseLogLevel(env),
    insecureHttpAllowed,
  });
}

export function inspectConfig(config: RuntimeConfig): string {
  return inspect(config, { depth: 3, breakLength: Infinity });
}
