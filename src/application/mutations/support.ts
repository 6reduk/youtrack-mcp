import type { MutationContext, SerializedCustomFieldChange } from "../ports.js";
import type { CustomFieldChange, FieldAtom, FieldValue } from "../../domain/field-values.js";
import { DomainValidationError, getSelectorEntry, type FieldSelector, type IssueSelector, type ProjectSelector } from "../../domain/identifiers.js";
import type { IssueSnapshot, UserSummary } from "../../domain/issue.js";
import type { Warning } from "../../domain/operation-result.js";
import type { FieldDefinition, ProjectSummary, SchemaSource } from "../../domain/project-schema.js";

export type MutationSchemaMode = "complete" | "partial";

export interface MutationSchemaEvidence {
  readonly mode: MutationSchemaMode;
  readonly fields: readonly FieldDefinition[];
  readonly sources: readonly SchemaSource[];
  readonly probeIssueId: string | null;
  readonly warnings: readonly Warning[];
}

export type MutationSchemaRequest =
  | { readonly purpose: "create"; readonly fieldsRequired: boolean; readonly probeIssue?: IssueSelector }
  | { readonly purpose: "existing_issue"; readonly probeIssue: IssueSelector };

function partialSchemaWarnings(
  source: "admin_project_fields" | "probe_issue",
  probeIssueId: string | null,
  includeRequiredFieldsWarning: boolean,
): readonly Warning[] {
  const details = {
    source,
    ...(probeIssueId === null ? {} : { probeIssueId }),
  };
  return [
    {
      kind: "schema_partial",
      message: source === "probe_issue"
        ? "The mutation was validated with partial project-schema evidence."
        : "The administrative project schema is incomplete.",
      details,
    },
    ...(includeRequiredFieldsWarning ? [{
      kind: "required_fields_unverified",
      message: "Unknown required project fields are delegated to YouTrack validation and defaults.",
      details,
    }] : []),
  ];
}

export async function loadMutationSchemaEvidence(
  context: MutationContext,
  project: ProjectSummary,
  request: MutationSchemaRequest,
): Promise<MutationSchemaEvidence> {
  const admin = await context.gateway.getAdminProjectSchema(project);
  if (admin.schemaComplete) {
    return {
      mode: "complete",
      fields: admin.fields,
      sources: [admin.source],
      probeIssueId: null,
      warnings: [],
    };
  }

  if (request.purpose === "create" && !request.fieldsRequired) {
    return {
      mode: "partial",
      fields: [],
      sources: [admin.source],
      probeIssueId: null,
      warnings: partialSchemaWarnings("admin_project_fields", null, true),
    };
  }

  const probeSelector = request.probeIssue;
  if (probeSelector === undefined) {
    throw new DomainValidationError("probe_issue_required_for_partial_schema");
  }
  const probe = await context.gateway.getProbeProjectSchema(probeSelector);
  if (probe === null) throw new DomainValidationError("probe_issue_not_found");
  if (probe.projectId !== project.id) throw new DomainValidationError("probe_project_mismatch");

  return {
    mode: "partial",
    fields: probe.fields,
    sources: [admin.source, probe.source],
    probeIssueId: probe.issueId,
    warnings: partialSchemaWarnings("probe_issue", probe.issueId, request.purpose === "create"),
  };
}

export async function resolveProjectExact(
  context: MutationContext,
  selector: ProjectSelector,
): Promise<ProjectSummary> {
  const candidates = await context.gateway.findProjects(selector);
  if (candidates.length !== 1) throw new DomainValidationError(candidates.length === 0 ? "project_not_found" : "project_ambiguous");
  const project = candidates[0];
  if (project === undefined) throw new DomainValidationError("project_not_found");
  return project;
}

export async function readIssueExact(
  context: MutationContext,
  selector: Parameters<MutationContext["gateway"]["getIssue"]>[0],
): Promise<IssueSnapshot> {
  const issue = await context.gateway.getIssue(selector, ["system", "description", "customFields", "users"]);
  if (issue === null) throw new DomainValidationError("issue_not_found");
  return issue;
}

export async function loadFields(
  context: MutationContext,
  project: ProjectSummary,
): Promise<readonly FieldDefinition[]> {
  const schema = await context.gateway.getAdminProjectSchema(project);
  if (!schema.schemaComplete) throw new DomainValidationError("schema_incomplete: project field schema is not proven complete");
  return schema.fields;
}

export function resolveFieldExact(
  fields: readonly FieldDefinition[],
  selector: FieldSelector,
): FieldDefinition {
  const entry = getSelectorEntry(selector, ["id", "exactName"]);
  const matches = fields.filter((field) => entry.key === "id" ? field.id === entry.value : field.name === entry.value);
  if (matches.length !== 1) throw new DomainValidationError(matches.length === 0 ? "field_not_found" : "field_ambiguous");
  const field = matches[0];
  if (field === undefined) throw new DomainValidationError("field_not_found");
  return field;
}

export function resolveFieldFromEvidence(
  evidence: MutationSchemaEvidence,
  selector: FieldSelector,
): FieldDefinition {
  try {
    return resolveFieldExact(evidence.fields, selector);
  } catch (error: unknown) {
    if (evidence.mode === "partial" && error instanceof DomainValidationError && error.message === "field_not_found") {
      throw new DomainValidationError("field_evidence_not_found");
    }
    throw error;
  }
}

export function issueCustomFieldType(fieldType: string): string {
  const mapping: Readonly<Record<string, string>> = {
    "enum[1]": "SingleEnumIssueCustomField", "enum[*]": "MultiEnumIssueCustomField",
    "build[1]": "SingleBuildIssueCustomField", "build[*]": "MultiBuildIssueCustomField",
    "state[1]": "StateIssueCustomField",
    "version[1]": "SingleVersionIssueCustomField", "version[*]": "MultiVersionIssueCustomField",
    "ownedField[1]": "SingleOwnedIssueCustomField", "ownedField[*]": "MultiOwnedIssueCustomField",
    "user[1]": "SingleUserIssueCustomField", "user[*]": "MultiUserIssueCustomField",
    "group[1]": "SingleGroupIssueCustomField", "group[*]": "MultiGroupIssueCustomField",
    integer: "SimpleIssueCustomField", float: "SimpleIssueCustomField",
    date: "DateIssueCustomField", "date and time": "SimpleIssueCustomField",
    period: "PeriodIssueCustomField", string: "SimpleIssueCustomField", text: "TextIssueCustomField",
  };
  const result = mapping[fieldType];
  if (result === undefined) throw new DomainValidationError("unsupported_field_type: no verified YouTrack write codec");
  return result;
}

function resolveAllowedEntity(field: FieldDefinition, atom: Extract<FieldAtom, { kind: "entity" }>): FieldAtom {
  const entry = getSelectorEntry(atom.selector, ["id", "exactName"]);
  const matches = field.allowedValues.filter((value) => entry.key === "id" ? value.id === entry.value : value.name === entry.value);
  if (matches.length === 0 && !field.valuesComplete) throw new DomainValidationError("allowed_values_incomplete");
  if (matches.length !== 1) throw new DomainValidationError(matches.length === 0 ? "field_value_not_found" : "field_value_ambiguous");
  const value = matches[0];
  if (value === undefined) throw new DomainValidationError("field_value_not_found");
  return { kind: "entity", selector: { id: value.id } };
}

async function resolveUser(
  context: MutationContext,
  atom: Extract<FieldAtom, { kind: "user" }>,
): Promise<{ readonly atom: FieldAtom; readonly user: UserSummary }> {
  const slice = await context.gateway.findUsers({ selector: atom.selector, page: { skip: 0, top: 100 }, includeBanned: true });
  const entry = getSelectorEntry(atom.selector, ["id", "login", "email"]);
  const matches = slice.items.filter((user) => user[entry.key] === entry.value);
  if (slice.hasMore) throw new DomainValidationError("user_ambiguous");
  if (matches.length !== 1) throw new DomainValidationError(matches.length === 0 ? "user_not_found" : "user_ambiguous");
  const user = matches[0];
  if (user === undefined) throw new DomainValidationError("user_not_found");
  if (user.banned === true) throw new DomainValidationError("user_banned");
  if (user.banned !== false) throw new DomainValidationError("user_status_unknown");
  return { atom: { kind: "user", selector: { id: user.id } }, user };
}

function encodeAtom(atom: FieldAtom): unknown {
  switch (atom.kind) {
    case "scalar": return atom.value;
    case "date": return atom.epochMillis;
    case "period": return { presentation: atom.iso8601, $type: "PeriodValue" };
    case "entity": return { id: getSelectorEntry(atom.selector, ["id", "exactName"]).value };
    case "user": return { id: getSelectorEntry(atom.selector, ["id", "login", "email"]).value };
  }
}

export async function serializeChange(
  context: MutationContext,
  field: FieldDefinition,
  change: CustomFieldChange,
  evidence: MutationSchemaEvidence,
): Promise<{
  readonly serialized: SerializedCustomFieldChange;
  readonly expected: FieldValue | null;
  readonly warnings: readonly Warning[];
}> {
  const type = issueCustomFieldType(field.fieldType);
  if (field.cardinality === "unknown") throw new DomainValidationError("unknown_cardinality");
  if (field.valueShape === "unknown") throw new DomainValidationError("unknown_value_shape");
  if (change.action === "clear") {
    if (field.required === true) throw new DomainValidationError("required_field: field cannot be cleared");
    return { serialized: { id: field.id, name: field.name, $type: type, value: null }, expected: null, warnings: [] };
  }
  const atoms = change.value.kind === "multi" ? change.value.values : [change.value];
  if (field.cardinality === "multi" && change.value.kind !== "multi") throw new DomainValidationError("cardinality_mismatch");
  if (field.cardinality === "single" && change.value.kind === "multi") throw new DomainValidationError("cardinality_mismatch");
  const resolved: FieldAtom[] = [];
  const warnings: Warning[] = [];
  for (const atom of atoms) {
    if (atom.kind !== field.valueShape) throw new DomainValidationError("field_value_kind_mismatch");
    if (atom.kind === "entity") resolved.push(resolveAllowedEntity(field, atom));
    else if (atom.kind === "user") {
      const user = await resolveUser(context, atom);
      if (field.valuesComplete) {
        if (!field.allowedValues.some((allowed) => allowed.id === user.user.id)) throw new DomainValidationError("user_not_allowed_for_field");
      } else if (evidence.mode === "complete") {
        throw new DomainValidationError("allowed_users_incomplete");
      } else {
        if (evidence.probeIssueId === null) throw new DomainValidationError("allowed_users_incomplete");
        warnings.push({
          kind: "user_assignability_unverified",
          message: "The user was resolved exactly, but project-field assignability is delegated to YouTrack validation.",
          details: { fieldId: field.id, probeIssueId: evidence.probeIssueId },
        });
      }
      resolved.push(user.atom);
    }
    else resolved.push(atom);
  }
  let expected: FieldValue;
  let value: unknown;
  if (change.value.kind === "multi") {
    expected = { kind: "multi", values: resolved };
    value = resolved.map(encodeAtom);
  } else {
    const first = resolved[0];
    if (first === undefined) throw new DomainValidationError("field_value_missing");
    expected = first;
    value = encodeAtom(first);
  }
  return { serialized: { id: field.id, name: field.name, $type: type, value }, expected, warnings };
}

export function observedField(issue: IssueSnapshot, fieldId: string): unknown {
  return issue.customFields.find((field) => field.id === fieldId)?.value ?? null;
}

export function fieldValueEquals(expected: unknown, actual: unknown): boolean {
  const isMulti = (value: unknown): value is { readonly kind: "multi"; readonly values: readonly unknown[] } =>
    typeof value === "object" && value !== null && "kind" in value && value.kind === "multi" &&
    "values" in value && Array.isArray(value.values);
  if (isMulti(expected) && isMulti(actual)) {
    const left = expected.values.map((value) => JSON.stringify(value)).sort();
    const right = actual.values.map((value) => JSON.stringify(value)).sort();
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return JSON.stringify(expected) === JSON.stringify(actual);
}
