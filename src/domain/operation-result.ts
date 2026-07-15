export type OperationStatus =
  | "ok"
  | "created"
  | "updated"
  | "existing"
  | "not_found"
  | "ambiguous"
  | "conflict"
  | "invalid"
  | "forbidden"
  | "failed";

export type TargetKind = "server" | "project" | "issue" | "user" | "tag" | "link" | "schema" | "agile_board";
export type SafeDetailValue = string | number | boolean | null;

export interface SafeTarget {
  readonly kind: TargetKind;
  readonly id?: string;
  readonly idReadable?: string;
  readonly name?: string;
  readonly url?: string;
}

export interface SafeError {
  readonly kind: string;
  readonly message: string;
  readonly httpStatus: number | null;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, SafeDetailValue>>;
}

export interface Warning {
  readonly kind: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, SafeDetailValue>>;
}

export interface Candidate {
  readonly kind: string;
  readonly id: string;
  readonly idReadable?: string;
  readonly name?: string;
  readonly login?: string;
  readonly url?: string;
}

export interface OperationStep {
  readonly name: string;
  readonly status: "planned" | "completed" | "skipped" | "failed" | "unknown";
  readonly requestId?: string;
  readonly verified?: boolean | null;
}

export interface PageInfo {
  readonly skip: number;
  readonly requestedTop: number;
  readonly returned: number;
  readonly hasMore: boolean;
}

export interface OperationResult<T> {
  readonly status: OperationStatus;
  readonly operation: string;
  readonly target: SafeTarget | null;
  readonly data: T | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly verified: boolean | null;
  readonly warnings: readonly Warning[];
  readonly candidates: readonly Candidate[];
  readonly journal: readonly OperationStep[];
  readonly error: SafeError | null;
  readonly requestId: string;
  readonly page: PageInfo | null;
}

interface ResultInput<T> {
  readonly status: OperationStatus;
  readonly operation: string;
  readonly requestId: string;
  readonly target?: SafeTarget | null;
  readonly data?: T | null;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly verified?: boolean | null;
  readonly warnings?: readonly Warning[];
  readonly candidates?: readonly Candidate[];
  readonly journal?: readonly OperationStep[];
  readonly error?: SafeError | null;
  readonly page?: PageInfo | null;
}

export function createOperationResult<T>(input: ResultInput<T>): OperationResult<T> {
  return Object.freeze({
    status: input.status,
    operation: input.operation,
    target: input.target ?? null,
    data: input.data ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    verified: input.verified ?? null,
    warnings: Object.freeze([...(input.warnings ?? [])]),
    candidates: Object.freeze([...(input.candidates ?? [])]),
    journal: Object.freeze([...(input.journal ?? [])]),
    error: input.error ?? null,
    requestId: input.requestId,
    page: input.page ?? null,
  });
}

export function createReadSuccess<T>(
  operation: string,
  requestId: string,
  data: T,
  page: PageInfo | null = null,
): OperationResult<T> {
  return createOperationResult({ status: "ok", operation, requestId, data, page });
}
