import { createHash } from "node:crypto";

import type { LinkDirection } from "./identifiers.js";
import type { SafeError, SafeTarget, Warning } from "./operation-result.js";

export const EXECUTE_PLAN_VERSION = 1 as const;
export const EXECUTE_PLAN_MAX_OPERATIONS = 20 as const;
export const EXECUTE_PLAN_MAX_WRITES = 20 as const;
export const EXECUTE_PLAN_MAX_OPERATION_ID_LENGTH = 64 as const;
export const EXECUTE_PLAN_MAX_CUSTOM_FIELD_CHANGES = 100 as const;
export const EXECUTE_PLAN_MAX_MULTI_VALUES = 100 as const;
export const EXECUTE_PLAN_HASH_DOMAIN = "youtrack_execute_plan:v1\n" as const;

export type ExecutePlanInputKind =
  | "update_issue"
  | "set_custom_field"
  | "set_issue_state"
  | "set_assignee"
  | "add_tag"
  | "remove_tag"
  | "add_link"
  | "remove_link";

export type CanonicalFieldAtom =
  | string
  | number
  | boolean
  | { readonly id: string }
  | { readonly $type: "PeriodValue"; readonly presentation: string };

export type CanonicalFieldValue =
  | CanonicalFieldAtom
  | readonly CanonicalFieldAtom[]
  | null;

export interface ResolvedOperationBaseV1 {
  readonly index: number;
  readonly operationId: string | null;
  readonly inputKind: ExecutePlanInputKind;
  readonly kind: "update_issue" | "tag_membership" | "issue_link";
  readonly subjectIssueId: string;
  readonly expectedUpdatedAt: number;
}

export interface ResolvedCustomFieldCommandV1 {
  readonly id: string;
  readonly $type: string;
  readonly value: CanonicalFieldValue;
}

export interface ResolvedUpdateCommandV1 {
  readonly summary?: string;
  readonly description?: string | null;
  readonly customFields?: readonly ResolvedCustomFieldCommandV1[];
}

export type ResolvedUpdatePostconditionV1 =
  | { readonly kind: "summary"; readonly value: string }
  | { readonly kind: "description"; readonly value: string | null }
  | {
    readonly kind: "custom_field";
    readonly fieldId: string;
    readonly value: CanonicalFieldValue;
  };

export interface ResolvedUpdateIssueV1 extends ResolvedOperationBaseV1 {
  readonly kind: "update_issue";
  readonly command: ResolvedUpdateCommandV1;
  readonly postconditions: readonly ResolvedUpdatePostconditionV1[];
}

export interface ResolvedTagMembershipV1 extends ResolvedOperationBaseV1 {
  readonly kind: "tag_membership";
  readonly tagId: string;
  readonly desiredPresent: boolean;
}

export interface ResolvedIssueLinkV1 extends ResolvedOperationBaseV1 {
  readonly kind: "issue_link";
  readonly targetIssueId: string;
  readonly linkTypeId: string;
  readonly direction: LinkDirection;
  readonly desiredPresent: boolean;
  readonly preventCycle: boolean;
}

export type ResolvedOperationV1 =
  | ResolvedUpdateIssueV1
  | ResolvedTagMembershipV1
  | ResolvedIssueLinkV1;

export interface ResolvedPlanV1 {
  readonly version: typeof EXECUTE_PLAN_VERSION;
  readonly operations: readonly ResolvedOperationV1[];
}

export type ExecutePlanStepStatus =
  | "planned"
  | "already_satisfied"
  | "updated"
  | "conflict"
  | "failed"
  | "uncertain"
  | "skipped";

export interface ExecutePlanStepResult {
  readonly index: number;
  readonly operationId: string | null;
  readonly inputKind: ExecutePlanInputKind;
  readonly target: SafeTarget | null;
  readonly status: ExecutePlanStepStatus;
  readonly alreadySatisfied: boolean | null;
  readonly verified: boolean | null;
  readonly warnings: readonly Warning[];
  readonly error: SafeError | null;
  readonly requestId: string | null;
  readonly before: unknown;
  readonly after: unknown;
}

export interface ExecutePlanResultData {
  readonly planVersion: typeof EXECUTE_PLAN_VERSION;
  readonly planHash: string | null;
  readonly resolvedPlan: ResolvedPlanV1 | null;
  readonly operationCount: number;
  readonly maxOperations: typeof EXECUTE_PLAN_MAX_OPERATIONS;
  readonly possibleWriteCount: number;
  readonly completedWriteCount: number;
  readonly alreadySatisfiedCount: number;
  readonly stoppedAtIndex: number | null;
  readonly partialCompletion: boolean;
  readonly operations: readonly ExecutePlanStepResult[];
}

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }

  return leftPoints.length - rightPoints.length;
}

function encodeJsonPrimitive(value: null | boolean | number | string): string {
  return JSON.stringify(value);
}

function assertDataProperty(
  owner: object,
  key: PropertyKey,
): PropertyDescriptor & { readonly value: unknown } {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  if (
    descriptor === undefined
    || !("value" in descriptor)
    || descriptor.enumerable !== true
  ) {
    throw new TypeError("Canonical JSON accepts enumerable data properties only");
  }
  return descriptor as PropertyDescriptor & { readonly value: unknown };
}

function encodeCanonicalJson(value: unknown, active: WeakSet<object>): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return encodeJsonPrimitive(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON numbers must be finite");
    }
    return encodeJsonPrimitive(value);
  }
  if (typeof value !== "object") {
    throw new TypeError(`Canonical JSON does not support ${typeof value} values`);
  }
  if (active.has(value)) {
    throw new TypeError("Canonical JSON does not support cyclic data");
  }

  active.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      for (const key of keys) {
        if (key === "length") {
          continue;
        }
        const index = typeof key === "string" && /^(?:0|[1-9]\d*)$/.test(key)
          ? Number(key)
          : Number.NaN;
        if (!Number.isSafeInteger(index) || index < 0 || index >= value.length) {
          throw new TypeError("Canonical JSON arrays cannot have extra properties");
        }
      }

      const encodedItems: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new TypeError("Canonical JSON arrays cannot be sparse");
        }
        const descriptor = assertDataProperty(value, String(index));
        encodedItems.push(encodeCanonicalJson(descriptor.value, active));
      }
      return `[${encodedItems.join(",")}]`;
    }

    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON objects must be plain objects");
    }

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) {
      throw new TypeError("Canonical JSON objects must have string keys only");
    }
    const keys = (ownKeys as string[]).sort(compareUnicodeCodePoints);
    const encodedProperties = keys.map((key) => {
      const descriptor = assertDataProperty(value, key);
      return `${encodeJsonPrimitive(key)}:${encodeCanonicalJson(descriptor.value, active)}`;
    });
    return `{${encodedProperties.join(",")}}`;
  } finally {
    active.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return encodeCanonicalJson(value, new WeakSet());
}

export function hashResolvedPlan(plan: ResolvedPlanV1): string {
  return createHash("sha256")
    .update(EXECUTE_PLAN_HASH_DOMAIN, "utf8")
    .update(canonicalJson(plan), "utf8")
    .digest("hex");
}

// Keep the accepted JSON subset explicit for downstream pure helpers.
export type { CanonicalJsonValue };
