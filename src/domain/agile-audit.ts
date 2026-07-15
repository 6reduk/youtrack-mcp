import type { UserSummary } from "./issue.js";
import type { ProjectSummary } from "./project-schema.js";

export type AgileBoardSelector = Readonly<{ id: string }> | Readonly<{ exactName: string }>;

export interface EntityValueSummary {
  readonly id: string | null;
  readonly name: string | null;
  readonly login: string | null;
  readonly idReadable: string | null;
  readonly type: string | null;
}

export interface AgileBoardSummary {
  readonly id: string;
  readonly name: string;
  readonly projects: readonly ProjectSummary[];
  readonly archived: null;
  readonly available: boolean | null;
  readonly url: string;
}

export interface SprintSummary {
  readonly id: string;
  readonly name: string;
  readonly goal: string | null;
  readonly startAt: number | null;
  readonly finishAt: number | null;
  readonly archived: boolean | null;
  readonly current: boolean | null;
  readonly isDefault: boolean | null;
}

export interface AgileColumnSummary {
  readonly id: string | null;
  readonly presentation: string | null;
  readonly resolved: boolean | null;
  readonly wipMin: number | null;
  readonly wipMax: number | null;
  readonly values: readonly EntityValueSummary[];
}

export interface AgileBoardDetails extends AgileBoardSummary {
  readonly owner: UserSummary | null;
  readonly columnField: EntityValueSummary | null;
  readonly columns: readonly AgileColumnSummary[];
  readonly swimlanes: {
    readonly enabled: boolean | null;
    readonly type: string | null;
    readonly field: EntityValueSummary | null;
    readonly values: readonly EntityValueSummary[];
  } | null;
  readonly orphanSwimlane: { readonly hidden: boolean | null; readonly atTop: boolean | null };
  readonly sprintSettings: {
    readonly disabled: boolean | null;
    readonly explicit: boolean | null;
    readonly query: string | null;
    readonly multipleSprints: boolean | null;
    readonly syncField: EntityValueSummary | null;
    readonly defaultSprint: EntityValueSummary | null;
    readonly hideSubtasks: boolean | null;
  } | null;
  readonly currentSprint: EntityValueSummary | null;
  readonly estimationField: EntityValueSummary | null;
  readonly originalEstimationField: EntityValueSummary | null;
  readonly cardFields: null;
  readonly status: {
    readonly valid: boolean | null;
    readonly hasJobs: boolean | null;
    readonly errors: readonly string[];
    readonly warnings: readonly string[];
  } | null;
}

export interface ProjectTeamMember extends UserSummary {
  readonly membership: "direct" | "via_group" | "unknown";
  readonly roles: readonly ProjectRoleSummary[] | null;
}

export interface ProjectRoleSummary { readonly id: string; readonly name: string; readonly description: string | null; }

export interface ProjectTeamGroup {
  readonly id: string;
  readonly name: string;
  readonly ringId: string | null;
  readonly usersCount: number | null;
  readonly allUsersGroup: boolean | null;
  readonly roles: readonly ProjectRoleSummary[] | null;
}

export interface ProjectTeamSnapshot {
  readonly project: ProjectSummary;
  readonly users: readonly ProjectTeamMember[];
  readonly groups: readonly ProjectTeamGroup[];
  readonly usersPage: { readonly skip: number; readonly requestedTop: number; readonly returned: number; readonly hasMore: boolean };
  readonly groupsPage: { readonly skip: number; readonly requestedTop: number; readonly returned: number; readonly hasMore: boolean };
  readonly teamRoles: readonly ProjectRoleSummary[] | null;
  readonly rolesAvailable: boolean;
  readonly warnings: readonly string[];
}

export const ISSUE_ACTIVITY_CATEGORIES = [
  "CustomFieldCategory",
  "IssueResolvedCategory",
  "LinksCategory",
  "SprintCategory",
  "TagsCategory",
] as const;

export type IssueActivityCategory = (typeof ISSUE_ACTIVITY_CATEGORIES)[number];
export type ActivityValue = string | number | boolean | null | EntityValueSummary | readonly ActivityValue[];

export interface IssueActivitySummary {
  readonly id: string;
  readonly type: string | null;
  readonly category: string | null;
  readonly timestamp: number;
  readonly author: UserSummary | null;
  readonly field: EntityValueSummary | null;
  readonly targetMember: string | null;
  readonly added: ActivityValue;
  readonly removed: ActivityValue;
}
