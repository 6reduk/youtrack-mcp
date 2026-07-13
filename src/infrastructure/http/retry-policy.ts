import { YouTrackHttpError } from "./error-mapper.js";

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 2_000,
});

export function shouldRetryRead(error: unknown, attempt: number, policy: RetryPolicy): boolean {
  return (
    error instanceof YouTrackHttpError &&
    error.retryable &&
    attempt < policy.maxAttempts
  );
}

export function retryDelayMs(
  error: YouTrackHttpError,
  attempt: number,
  policy: RetryPolicy,
): number {
  if (error.retryAfterMs !== null) {
    return Math.min(error.retryAfterMs, policy.maxDelayMs);
  }
  const exponent = Math.max(0, attempt - 1);
  return Math.min(policy.baseDelayMs * 2 ** exponent, policy.maxDelayMs);
}
