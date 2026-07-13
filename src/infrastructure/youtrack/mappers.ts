import type { IssueCustomFieldSnapshot, IssueSnapshot, TagSummary, UserSummary } from "../../domain/issue.js";
import type { IssueReference, LinkSnapshot, LinkTypeDefinition } from "../../domain/links.js";
import type { AllowedValue, FieldDefinition, ProjectSummary, SchemaSourceKind } from "../../domain/project-schema.js";
import { decodeReadableFieldValue, valueShapeFor } from "./custom-field-codecs.js";
import type {
  AllowedValueDto,
  IssueCustomFieldDto,
  IssueDto,
  IssueLinkDto,
  IssueReferenceDto,
  LinkTypeDto,
  ProjectDto,
  ProjectFieldDto,
  TagDto,
  UserDto,
} from "./dtos.js";

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`Invalid ${label} in YouTrack response`);
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalEpoch(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function pageUrl(baseUrl: URL, path: string): string {
  return new URL(path, baseUrl).href;
}

export function mapUser(dto: UserDto): UserSummary {
  return {
    id: requiredString(dto.id, "user id"),
    login: requiredString(dto.login, "user login"),
    name: optionalString(dto.fullName) ?? optionalString(dto.name),
    email: optionalString(dto.email),
    banned: typeof dto.banned === "boolean" ? dto.banned : null,
  };
}

export function mapProject(dto: ProjectDto, baseUrl: URL): ProjectSummary {
  const shortName = requiredString(dto.shortName, "project shortName");
  return {
    id: requiredString(dto.id, "project id"),
    shortName,
    name: requiredString(dto.name, "project name"),
    archived: dto.archived === true,
    url: pageUrl(baseUrl, `projects/${encodeURIComponent(shortName)}`),
  };
}

export function mapTag(dto: TagDto, baseUrl: URL): TagSummary {
  const id = requiredString(dto.id, "tag id");
  return {
    id,
    name: requiredString(dto.name, "tag name"),
    url: pageUrl(baseUrl, `tags/${encodeURIComponent(id)}`),
    owner: dto.owner == null ? null : mapUser(dto.owner),
  };
}

export function mapLinkType(dto: LinkTypeDto): LinkTypeDefinition {
  const localizedNames = [dto.localizedName, dto.localizedSourceToTarget, dto.localizedTargetToSource]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  return {
    id: requiredString(dto.id, "link type id"),
    name: requiredString(dto.name, "link type name"),
    directed: dto.directed === true,
    aggregation: dto.aggregation === true,
    sourceToTargetName: requiredString(dto.sourceToTarget, "link sourceToTarget"),
    targetToSourceName: optionalString(dto.targetToSource),
    localizedNames: [...new Set(localizedNames)],
  };
}

export function mapIssueReference(dto: IssueReferenceDto, baseUrl: URL): IssueReference {
  const idReadable = requiredString(dto.idReadable, "issue idReadable");
  return {
    id: requiredString(dto.id, "issue id"),
    idReadable,
    summary: requiredString(dto.summary, "issue summary"),
    url: pageUrl(baseUrl, `issue/${encodeURIComponent(idReadable)}`),
  };
}

function allowedValue(dto: AllowedValueDto): AllowedValue {
  const name = optionalString(dto.name) ?? optionalString(dto.fullName) ?? optionalString(dto.login);
  return {
    id: requiredString(dto.id, "allowed value id"),
    name: requiredString(name, "allowed value name"),
    kind: optionalString(dto.$type) ?? "unknown",
    ...(typeof dto.isResolved === "boolean" ? { resolved: dto.isResolved } : {}),
  };
}

export function mapProjectField(
  dto: ProjectFieldDto,
  source: SchemaSourceKind,
  valuesComplete: boolean,
  allowedValueOverride?: readonly AllowedValueDto[],
): FieldDefinition {
  const valueType = optionalString(dto.field?.fieldType?.valueType);
  const rawType = optionalString(dto.$type);
  const fieldType = optionalString(dto.field?.fieldType?.id);
  const values = allowedValueOverride ?? dto.bundle?.values ?? dto.bundle?.aggregatedUsers ?? [];
  return {
    id: requiredString(dto.id, "project custom field id"),
    name: requiredString(dto.field?.name, "project custom field name"),
    fieldType: fieldType ?? rawType ?? "unknown",
    valueType,
    valueShape: valueShapeFor(valueType),
    cardinality: fieldType?.endsWith("[*]") === true
      ? "multi"
      : fieldType?.endsWith("[1]") === true || (fieldType !== null && !fieldType.includes("["))
        ? "single"
        : "unknown",
    required: typeof dto.canBeEmpty === "boolean" ? !dto.canBeEmpty : null,
    hasDefaultValue: Array.isArray(dto.defaultValues) ? dto.defaultValues.length > 0 : null,
    writability: "unknown",
    valuesComplete,
    allowedValues: values.map(allowedValue),
    provenance: [source],
  };
}

export function mapIssueCustomField(dto: IssueCustomFieldDto): IssueCustomFieldSnapshot {
  const projectField = dto.projectCustomField;
  const valueType = optionalString(projectField?.field?.fieldType?.valueType);
  const shape = valueShapeFor(valueType);
  return {
    id: requiredString(dto.id, "issue custom field id"),
    name: requiredString(dto.name, "issue custom field name"),
    fieldType: optionalString(projectField?.field?.fieldType?.id) ?? optionalString(dto.$type) ?? "unknown",
    valueType,
    value: decodeReadableFieldValue(dto.value, shape),
    rawType: optionalString(dto.$type),
  };
}

export function mapIssue(
  dto: IssueDto,
  baseUrl: URL,
  tags: readonly TagSummary[] = [],
  links: readonly LinkSnapshot[] = [],
): IssueSnapshot {
  if (dto.project == null) throw new TypeError("Invalid issue project in YouTrack response");
  const reference = mapIssueReference(dto, baseUrl);
  const reporter = dto.reporter == null ? null : mapUser(dto.reporter);
  return {
    ...reference,
    description: optionalString(dto.description),
    project: mapProject(dto.project, baseUrl),
    reporter,
    creator: null,
    updater: dto.updater == null ? null : mapUser(dto.updater),
    createdAt: optionalEpoch(dto.created),
    updatedAt: optionalEpoch(dto.updated),
    resolvedAt: optionalEpoch(dto.resolved),
    customFields: (dto.customFields ?? []).map(mapIssueCustomField),
    tags,
    links,
  };
}

export function mapLinkContainer(
  baseIssue: IssueReference,
  dto: IssueLinkDto,
  baseUrl: URL,
): readonly LinkSnapshot[] {
  if (dto.linkType == null) throw new TypeError("Invalid issue link type in YouTrack response");
  const type = mapLinkType(dto.linkType);
  const outward = dto.direction === "OUTWARD" || dto.direction === "BOTH";
  return (dto.issues ?? []).map((relatedDto) => {
    const related = mapIssueReference(relatedDto, baseUrl);
    return {
      id: optionalString(dto.id),
      type,
      direction: outward ? "source_to_target" : "target_to_source",
      source: outward ? baseIssue : related,
      target: outward ? related : baseIssue,
    };
  });
}
