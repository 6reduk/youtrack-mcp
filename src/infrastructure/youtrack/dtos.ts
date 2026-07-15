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

export interface EntityValueDto {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly login?: unknown;
  readonly idReadable?: unknown;
  readonly $type?: unknown;
}

export interface AgileDto {
  readonly id?: unknown; readonly name?: unknown; readonly projects?: readonly ProjectDto[];
  readonly owner?: UserDto | null; readonly currentSprint?: EntityValueDto | null;
  readonly columnSettings?: { readonly field?: EntityValueDto | null; readonly columns?: readonly { readonly id?: unknown; readonly presentation?: unknown; readonly isResolved?: unknown; readonly wipLimit?: { readonly min?: unknown; readonly max?: unknown } | null; readonly fieldValues?: readonly EntityValueDto[] }[] } | null;
  readonly swimlaneSettings?: { readonly enabled?: unknown; readonly $type?: unknown; readonly field?: EntityValueDto | null; readonly values?: readonly EntityValueDto[] } | null;
  readonly hideOrphansSwimlane?: unknown; readonly orphansAtTheTop?: unknown;
  readonly sprintsSettings?: { readonly disableSprints?: unknown; readonly isExplicit?: unknown; readonly explicitQuery?: unknown; readonly cardOnSeveralSprints?: unknown; readonly sprintSyncField?: EntityValueDto | null; readonly defaultSprint?: EntityValueDto | null; readonly hideSubtasksOfCards?: unknown } | null;
  readonly estimationField?: EntityValueDto | null; readonly originalEstimationField?: EntityValueDto | null;
  readonly status?: { readonly valid?: unknown; readonly hasJobs?: unknown; readonly errors?: unknown; readonly warnings?: unknown } | null;
}

export interface SprintDto { readonly id?: unknown; readonly name?: unknown; readonly goal?: unknown; readonly start?: unknown; readonly finish?: unknown; readonly archived?: unknown; readonly isDefault?: unknown; }
export interface UserGroupDto { readonly id?: unknown; readonly name?: unknown; readonly ringId?: unknown; readonly usersCount?: unknown; readonly allUsersGroup?: unknown; }
export interface ActivityDto { readonly id?: unknown; readonly $type?: unknown; readonly timestamp?: unknown; readonly author?: UserDto | null; readonly category?: { readonly id?: unknown } | null; readonly field?: EntityValueDto | null; readonly targetMember?: unknown; readonly added?: unknown; readonly removed?: unknown; }
export interface AssignedRoleDto { readonly id?: unknown; readonly role?: { readonly id?: unknown; readonly name?: unknown; readonly description?: unknown } | null; readonly holder?: { readonly id?: unknown; readonly $type?: unknown } | null; readonly scope?: { readonly id?: unknown; readonly $type?: unknown; readonly project?: { readonly id?: unknown } | null } | null; }
