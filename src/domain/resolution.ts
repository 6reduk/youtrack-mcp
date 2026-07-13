import {
  DomainValidationError,
  getSelectorEntry,
  type SinglePropertySelector,
} from "./identifiers.js";

export type Resolution<T> =
  | { readonly status: "resolved"; readonly value: T }
  | { readonly status: "not_found" }
  | {
      readonly status: "ambiguous";
      readonly candidates: readonly T[];
      readonly totalMatches: number;
      readonly truncated: boolean;
    };

export type SelectorAccessors<T, K extends string> = Readonly<
  Record<K, (candidate: T) => string | null | undefined>
>;

export interface ResolveExactOptions<T, K extends string> {
  readonly selector: SinglePropertySelector<K>;
  readonly candidates: readonly T[];
  readonly accessors: SelectorAccessors<T, K>;
  readonly candidateLimit?: number;
}

export function resolveExact<T, K extends string>(
  options: ResolveExactOptions<T, K>,
): Resolution<T> {
  const keys = Object.keys(options.accessors) as K[];
  const { key, value } = getSelectorEntry(options.selector, keys);
  const accessor = options.accessors[key];

  const matches = options.candidates.filter((candidate) => accessor(candidate) === value);
  if (matches.length === 0) {
    return { status: "not_found" };
  }
  if (matches.length === 1) {
    const match = matches[0];
    if (match === undefined) {
      throw new DomainValidationError("Resolved candidate unexpectedly disappeared");
    }
    return { status: "resolved", value: match };
  }

  const limit = options.candidateLimit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new DomainValidationError("candidateLimit must be a positive integer");
  }
  return {
    status: "ambiguous",
    candidates: Object.freeze(matches.slice(0, limit)),
    totalMatches: matches.length,
    truncated: matches.length > limit,
  };
}
