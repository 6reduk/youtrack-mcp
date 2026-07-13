export interface Postcondition<TSnapshot, TValue> {
  readonly name: string;
  readonly expected: TValue;
  readonly observe: (snapshot: TSnapshot) => TValue;
  readonly equals?: (expected: TValue, actual: TValue) => boolean;
}

export interface VerificationMismatch {
  readonly name: string;
  readonly expected: unknown;
  readonly actual: unknown;
}

export interface VerificationResult {
  readonly verified: boolean;
  readonly mismatches: readonly VerificationMismatch[];
}

function jsonEquals(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function verifyPostconditions<TSnapshot>(
  snapshot: TSnapshot,
  conditions: readonly Postcondition<TSnapshot, unknown>[],
): VerificationResult {
  const mismatches: VerificationMismatch[] = [];
  for (const condition of conditions) {
    const actual = condition.observe(snapshot);
    const equals = condition.equals ?? jsonEquals;
    if (!equals(condition.expected, actual)) {
      mismatches.push({ name: condition.name, expected: condition.expected, actual });
    }
  }

  return Object.freeze({ verified: mismatches.length === 0, mismatches: Object.freeze(mismatches) });
}
