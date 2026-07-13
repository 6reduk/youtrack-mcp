import type { EntitySelector, FieldSelector, UserSelector } from "./identifiers.js";
import { DomainValidationError, getSelectorEntry } from "./identifiers.js";
import type { FieldDefinition, FieldValueShape } from "./project-schema.js";

export type ScalarValue = string | number | boolean;

export type FieldAtom =
  | { readonly kind: "scalar"; readonly value: ScalarValue }
  | { readonly kind: "date"; readonly epochMillis: number }
  | { readonly kind: "period"; readonly iso8601: string }
  | { readonly kind: "entity"; readonly selector: EntitySelector }
  | { readonly kind: "user"; readonly selector: UserSelector };

export type FieldValue = FieldAtom | { readonly kind: "multi"; readonly values: readonly FieldAtom[] };

export type CustomFieldChange = { readonly field: FieldSelector } & (
  | { readonly action: "set"; readonly value: FieldValue }
  | { readonly action: "clear" }
);

export type FieldValueValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly kind: string; readonly message: string };

const MAX_MULTI_VALUES = 100;

function atomShape(atom: FieldAtom): FieldValueShape {
  return atom.kind;
}

function canonicalAtom(atom: FieldAtom): string {
  switch (atom.kind) {
    case "scalar":
      return `${atom.kind}:${typeof atom.value}:${String(atom.value)}`;
    case "date":
      return `${atom.kind}:${String(atom.epochMillis)}`;
    case "period":
      return `${atom.kind}:${atom.iso8601}`;
    case "entity": {
      const entry = getSelectorEntry(atom.selector, ["id", "exactName"]);
      return `${atom.kind}:${entry.key}:${entry.value}`;
    }
    case "user": {
      const entry = getSelectorEntry(atom.selector, ["id", "login", "email"]);
      return `${atom.kind}:${entry.key}:${entry.value}`;
    }
  }
}

function validateAtom(atom: FieldAtom, expectedShape: FieldValueShape): FieldValueValidation {
  if (expectedShape === "unknown") {
    return {
      valid: false,
      kind: "unsupported_field_type",
      message: "The discovered field type has no write codec",
    };
  }
  if (atomShape(atom) !== expectedShape) {
    return {
      valid: false,
      kind: "field_value_kind_mismatch",
      message: `Expected ${expectedShape} but received ${atom.kind}`,
    };
  }

  switch (atom.kind) {
    case "scalar":
      return typeof atom.value === "number" && !Number.isFinite(atom.value)
        ? { valid: false, kind: "invalid_number", message: "Numeric values must be finite" }
        : { valid: true };
    case "date":
      return Number.isSafeInteger(atom.epochMillis)
        ? { valid: true }
        : { valid: false, kind: "invalid_date", message: "Date must be safe integer epoch millis" };
    case "period":
      return /^P(?!$)/.test(atom.iso8601)
        ? { valid: true }
        : { valid: false, kind: "invalid_period", message: "Period must use an ISO-8601 P value" };
    case "entity":
      getSelectorEntry(atom.selector, ["id", "exactName"]);
      return { valid: true };
    case "user":
      getSelectorEntry(atom.selector, ["id", "login", "email"]);
      return { valid: true };
  }
}

export function validateFieldChange(
  field: FieldDefinition,
  change: CustomFieldChange,
): FieldValueValidation {
  if (field.writability !== "writable") {
    return { valid: false, kind: "field_not_writable", message: "Field is not proven writable" };
  }
  if (change.action === "clear") {
    return field.required === true
      ? { valid: false, kind: "required_field", message: "A required field cannot be cleared" }
      : { valid: true };
  }
  if (field.valueShape === "unknown") {
    return {
      valid: false,
      kind: "unsupported_field_type",
      message: "The discovered field type has no write codec",
    };
  }
  if (field.cardinality === "unknown") {
    return {
      valid: false,
      kind: "unknown_cardinality",
      message: "Field cardinality is not proven",
    };
  }

  const { value } = change;
  if (value.kind === "multi") {
    if (field.cardinality !== "multi") {
      return { valid: false, kind: "cardinality_mismatch", message: "Field is not multi-valued" };
    }
    if (value.values.length > MAX_MULTI_VALUES) {
      return { valid: false, kind: "too_many_values", message: "At most 100 values are accepted" };
    }

    const seen = new Set<string>();
    for (const atom of value.values) {
      const validation = validateAtom(atom, field.valueShape);
      if (!validation.valid) {
        return validation;
      }
      const canonical = canonicalAtom(atom);
      if (seen.has(canonical)) {
        return { valid: false, kind: "duplicate_value", message: "Multi values must be unique" };
      }
      seen.add(canonical);
    }
    return { valid: true };
  }

  if (field.cardinality === "multi") {
    return { valid: false, kind: "cardinality_mismatch", message: "Field requires a multi value" };
  }
  return validateAtom(value, field.valueShape);
}

export function assertSupportedFieldChange(
  field: FieldDefinition,
  change: CustomFieldChange,
): void {
  const result = validateFieldChange(field, change);
  if (!result.valid) {
    throw new DomainValidationError(`${result.kind}: ${result.message}`);
  }
}
