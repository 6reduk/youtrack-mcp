import type { LogLevel } from "../config.js";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const SENSITIVE_KEY = /authorization|cookie|token|secret|password|api[-_]?key/i;
const BEARER_VALUE = /Bearer\s+[^\s,;]+/gi;
const MAX_DEPTH = 8;

export interface LogRecord {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly details?: unknown;
}

export interface Logger {
  error(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  info(message: string, details?: unknown): void;
  debug(message: string, details?: unknown): void;
}

export type LogSink = (line: string) => void;

export interface RedactingLoggerOptions {
  readonly level: LogLevel;
  readonly secrets?: readonly string[];
  readonly sink?: LogSink;
  readonly now?: () => Date;
}

function redactString(value: string, secrets: readonly string[]): string {
  let redacted = value.replace(BEARER_VALUE, "Bearer [REDACTED]");
  for (const secret of secrets) {
    if (secret.length > 0) {
      redacted = redacted.replaceAll(secret, "[REDACTED]");
    }
  }
  return redacted;
}

function sanitize(
  value: unknown,
  secrets: readonly string[],
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (depth > MAX_DEPTH) {
    return "[MAX_DEPTH]";
  }
  if (typeof value === "string") {
    return redactString(value, secrets);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message, secrets),
    };
  }
  if (seen.has(value)) {
    return "[CIRCULAR]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, secrets, seen, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(key)
      ? "[REDACTED]"
      : sanitize(nested, secrets, seen, depth + 1);
  }
  return result;
}

export class RedactingLogger implements Logger {
  readonly #level: LogLevel;
  readonly #secrets: readonly string[];
  readonly #sink: LogSink;
  readonly #now: () => Date;

  public constructor(options: RedactingLoggerOptions) {
    this.#level = options.level;
    this.#secrets = options.secrets ?? [];
    this.#sink = options.sink ?? ((line) => process.stderr.write(`${line}\n`));
    this.#now = options.now ?? (() => new Date());
  }

  public error(message: string, details?: unknown): void {
    this.write("error", message, details);
  }

  public warn(message: string, details?: unknown): void {
    this.write("warn", message, details);
  }

  public info(message: string, details?: unknown): void {
    this.write("info", message, details);
  }

  public debug(message: string, details?: unknown): void {
    this.write("debug", message, details);
  }

  private write(level: LogLevel, message: string, details?: unknown): void {
    if (LEVEL_PRIORITY[level] > LEVEL_PRIORITY[this.#level]) {
      return;
    }

    const record: LogRecord = {
      timestamp: this.#now().toISOString(),
      level,
      message: redactString(message, this.#secrets),
      ...(details === undefined
        ? {}
        : { details: sanitize(details, this.#secrets, new WeakSet(), 0) }),
    };
    this.#sink(JSON.stringify(record));
  }
}
