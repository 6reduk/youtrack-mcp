export type SchemaSourceKind = "admin_project_fields" | "probe_issue";
export type SchemaSourceOutcome = "ok" | "empty" | "forbidden" | "partial" | "failed";
export type Cardinality = "single" | "multi" | "unknown";
export type Writability = "writable" | "read_only" | "unknown";
export type FieldValueShape = "scalar" | "date" | "period" | "entity" | "user" | "unknown";
export type ReadCompleteness = "complete" | "partial" | "unavailable";
export type CompletenessReason =
  | "authoritative_source_exhausted"
  | "source_empty"
  | "source_forbidden"
  | "fallback_source"
  | "source_truncated"
  | "source_unavailable";

export interface CompletenessEvidence {
  readonly status: ReadCompleteness;
  readonly reason: CompletenessReason;
}

export interface ProjectSummary {
  readonly id: string;
  readonly shortName: string;
  readonly name: string;
  readonly archived: boolean;
  readonly url: string;
}

export interface SchemaSource {
  readonly kind: SchemaSourceKind;
  readonly outcome: SchemaSourceOutcome;
}

export interface AllowedValue {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly resolved?: boolean;
}

export interface FieldDefinition {
  readonly id: string;
  readonly name: string;
  readonly fieldType: string;
  readonly valueType: string | null;
  readonly valueShape: FieldValueShape;
  readonly cardinality: Cardinality;
  readonly required: boolean | null;
  readonly hasDefaultValue?: boolean | null;
  readonly writability: Writability;
  readonly valuesComplete: boolean;
  readonly allowedValues: readonly AllowedValue[];
  readonly provenance: readonly SchemaSourceKind[];
}

export interface ProjectSchema {
  readonly project: ProjectSummary;
  readonly schemaComplete: boolean;
  readonly completeness: CompletenessEvidence;
  readonly sources: readonly SchemaSource[];
  readonly fields: readonly FieldDefinition[];
}

export function canWriteField(field: FieldDefinition): boolean {
  return (
    field.writability === "writable" &&
    field.valueShape !== "unknown" &&
    field.cardinality !== "unknown"
  );
}

export function hasCompleteAllowedValues(field: FieldDefinition): boolean {
  return field.valuesComplete;
}
