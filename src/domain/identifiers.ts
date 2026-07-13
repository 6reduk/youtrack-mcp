export type SinglePropertySelector<K extends string> = K extends K ? Readonly<Record<K, string>> : never;

export type EntitySelector = SinglePropertySelector<"id" | "exactName">;
export type ProjectSelector = SinglePropertySelector<"id" | "shortName">;
export type IssueSelector = SinglePropertySelector<"id" | "idReadable">;
export type UserSelector = SinglePropertySelector<"id" | "login" | "email">;
export type TagSelector = SinglePropertySelector<"id" | "exactName">;
export type FieldSelector = SinglePropertySelector<"id" | "exactName">;
export type LinkTypeSelector = SinglePropertySelector<"id" | "exactName">;

export type LinkDirection = "source_to_target" | "target_to_source";

export interface SelectorEntry<K extends string = string> {
  readonly key: K;
  readonly value: string;
}

export class DomainValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DomainValidationError";
  }
}

export function createSelector<K extends string>(
  key: K,
  rawValue: string,
): SinglePropertySelector<K> {
  const value = rawValue.trim();
  if (value.length === 0) {
    throw new DomainValidationError("Selector values must be non-empty");
  }

  return { [key]: value } as SinglePropertySelector<K>;
}

export function getSelectorEntry<K extends string>(
  selector: Readonly<Partial<Record<K, string>>>,
  allowedKeys: readonly K[],
): SelectorEntry<K> {
  const entries = Object.entries(selector).filter(([, value]) => value !== undefined);
  if (entries.length !== 1) {
    throw new DomainValidationError("A selector must contain exactly one discriminator");
  }

  const entry = entries[0];
  if (entry === undefined) {
    throw new DomainValidationError("A selector must contain exactly one discriminator");
  }

  const [rawKey, rawValue] = entry;
  if (!allowedKeys.includes(rawKey as K)) {
    throw new DomainValidationError("Selector discriminator is not supported here");
  }
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    throw new DomainValidationError("Selector values must be non-empty");
  }

  return { key: rawKey as K, value: rawValue.trim() };
}

export interface PageRequest {
  readonly skip: number;
  readonly top: number;
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
export const MAX_PAGE_SKIP = 100_000;

export function createPageRequest(skip = 0, top = DEFAULT_PAGE_SIZE): PageRequest {
  if (!Number.isSafeInteger(skip) || skip < 0 || skip > MAX_PAGE_SKIP) {
    throw new DomainValidationError(`skip must be an integer from 0 to ${String(MAX_PAGE_SKIP)}`);
  }
  if (!Number.isSafeInteger(top) || top < 1 || top > MAX_PAGE_SIZE) {
    throw new DomainValidationError(`top must be an integer from 1 to ${String(MAX_PAGE_SIZE)}`);
  }

  return Object.freeze({ skip, top });
}
