export interface UserDto {
  readonly id?: unknown;
  readonly login?: unknown;
  readonly name?: unknown;
  readonly fullName?: unknown;
  readonly email?: unknown;
  readonly banned?: unknown;
}

export interface ProjectDto {
  readonly id?: unknown;
  readonly shortName?: unknown;
  readonly name?: unknown;
  readonly archived?: unknown;
}

export interface TagDto {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly owner?: UserDto | null;
}

export interface LinkTypeDto {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly localizedName?: unknown;
  readonly directed?: unknown;
  readonly aggregation?: unknown;
  readonly sourceToTarget?: unknown;
  readonly targetToSource?: unknown;
  readonly localizedSourceToTarget?: unknown;
  readonly localizedTargetToSource?: unknown;
}

export interface AllowedValueDto {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly localizedName?: unknown;
  readonly login?: unknown;
  readonly fullName?: unknown;
  readonly isResolved?: unknown;
  readonly $type?: unknown;
}

export interface ProjectFieldDto {
  readonly id?: unknown;
  readonly $type?: unknown;
  readonly canBeEmpty?: unknown;
  readonly isPublic?: unknown;
  readonly defaultValues?: readonly unknown[] | null;
  readonly field?: {
    readonly id?: unknown;
    readonly name?: unknown;
    readonly fieldType?: { readonly id?: unknown; readonly valueType?: unknown } | null;
  } | null;
  readonly bundle?: {
    readonly id?: unknown;
    readonly values?: readonly AllowedValueDto[];
    readonly aggregatedUsers?: readonly UserDto[];
  } | null;
}

export interface IssueCustomFieldDto {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly $type?: unknown;
  readonly value?: unknown;
  readonly projectCustomField?: ProjectFieldDto | null;
}

export interface IssueReferenceDto {
  readonly id?: unknown;
  readonly idReadable?: unknown;
  readonly summary?: unknown;
}

export interface IssueLinkDto {
  readonly id?: unknown;
  readonly direction?: unknown;
  readonly linkType?: LinkTypeDto | null;
  readonly issues?: readonly IssueReferenceDto[];
}

export interface IssueDto extends IssueReferenceDto {
  readonly description?: unknown;
  readonly created?: unknown;
  readonly updated?: unknown;
  readonly resolved?: unknown;
  readonly project?: ProjectDto | null;
  readonly reporter?: UserDto | null;
  readonly updater?: UserDto | null;
  readonly customFields?: readonly IssueCustomFieldDto[];
  readonly tags?: readonly TagDto[];
  readonly links?: readonly IssueLinkDto[];
}
