export type HttpErrorKind =
  | "authentication_failed"
  | "permission_denied"
  | "upstream_not_found"
  | "upstream_conflict"
  | "rate_limited"
  | "upstream_validation"
  | "upstream_unavailable"
  | "redirect_rejected"
  | "invalid_json"
  | "invalid_response"
  | "response_too_large"
  | "request_timeout"
  | "transport_error"
  | "unexpected_status";

export interface HttpErrorOptions {
  readonly kind: HttpErrorKind;
  readonly message: string;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly requestId: string;
  readonly retryAfterMs?: number | null;
  readonly cause?: unknown;
}

export class YouTrackHttpError extends Error {
  public readonly kind: HttpErrorKind;
  public readonly status: number | null;
  public readonly retryable: boolean;
  public readonly requestId: string;
  public readonly retryAfterMs: number | null;

  public constructor(options: HttpErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "YouTrackHttpError";
    this.kind = options.kind;
    this.status = options.status;
    this.retryable = options.retryable;
    this.requestId = options.requestId;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (value === null) {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }

  const date = Date.parse(value);
  if (Number.isNaN(date)) {
    return null;
  }
  return Math.max(0, date - now);
}

export function mapHttpStatus(
  status: number,
  requestId: string,
  retryAfter: string | null = null,
): YouTrackHttpError {
  if (status === 401) {
    return new YouTrackHttpError({
      kind: "authentication_failed",
      message: "YouTrack rejected the configured credentials",
      status,
      retryable: false,
      requestId,
    });
  }
  if (status === 403) {
    return new YouTrackHttpError({
      kind: "permission_denied",
      message: "The configured user is not permitted to access this YouTrack resource",
      status,
      retryable: false,
      requestId,
    });
  }
  if (status === 404) {
    return new YouTrackHttpError({
      kind: "upstream_not_found",
      message: "The requested YouTrack resource was not found",
      status,
      retryable: false,
      requestId,
    });
  }
  if (status === 409) {
    return new YouTrackHttpError({
      kind: "upstream_conflict",
      message: "YouTrack reported a conflict",
      status,
      retryable: false,
      requestId,
    });
  }
  if (status === 429) {
    return new YouTrackHttpError({
      kind: "rate_limited",
      message: "YouTrack rate-limited the request",
      status,
      retryable: true,
      requestId,
      retryAfterMs: parseRetryAfter(retryAfter),
    });
  }
  if (status === 400 || status === 422) {
    return new YouTrackHttpError({
      kind: "upstream_validation",
      message: "YouTrack rejected the request as invalid",
      status,
      retryable: false,
      requestId,
    });
  }
  if (status >= 500 && status <= 599) {
    return new YouTrackHttpError({
      kind: "upstream_unavailable",
      message: "YouTrack is temporarily unavailable",
      status,
      retryable: true,
      requestId,
    });
  }

  return new YouTrackHttpError({
    kind: "unexpected_status",
    message: "YouTrack returned an unexpected HTTP status",
    status,
    retryable: false,
    requestId,
  });
}
