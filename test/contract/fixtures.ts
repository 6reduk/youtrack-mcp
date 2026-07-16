export const USER_DTO = {
  id: "user-x-id",
  login: "reader.x",
  fullName: "Reader X",
  email: "reader.x@example.test",
  banned: false,
};

export const PROJECT_DTO = {
  id: "project-x-id",
  shortName: "PX",
  name: "Project X",
  archived: false,
};

export const ISSUE_DTO = {
  id: "issue-x-id",
  idReadable: "PX-17",
  summary: "Neutral issue",
  description: "Body",
  created: 10,
  updated: 20,
  resolved: null,
  project: PROJECT_DTO,
  reporter: USER_DTO,
  updater: USER_DTO,
  customFields: [],
};

export const PROJECT_FIELD_DTO = {
  id: "project-field-x-id",
  $type: "SingleEnumProjectCustomField",
  canBeEmpty: true,
  isPublic: true,
  field: {
    id: "field-x-id",
    name: "Arbitrary phase label",
    fieldType: { id: "enum[1]", valueType: "enum" },
  },
  bundle: {
    id: "bundle-x-id",
    values: [{ id: "choice-x-id", name: "Choice X", $type: "EnumBundleElement" }],
  },
};

export const AGILE_DTO = {
  id: "board-x-id", name: "Board X", projects: [PROJECT_DTO], owner: USER_DTO,
  currentSprint: { id: "sprint-x-id", name: "Iteration X", $type: "Sprint" },
  columnSettings: { field: { id: "field-column-x", name: "Workflow X", $type: "CustomField" }, columns: [{ id: "column-x", presentation: "Queue X", isResolved: false, fieldValues: [{ id: "value-x", name: "Queue X", $type: "AgileColumnFieldValue" }] }] },
  swimlaneSettings: { enabled: true, $type: "AttributeBasedSwimlaneSettings", field: { id: "field-lane-x", name: "Lane X", $type: "CustomField" }, values: [] },
  hideOrphansSwimlane: false, orphansAtTheTop: true,
  sprintsSettings: { disableSprints: false, isExplicit: false, explicitQuery: "project: PX", cardOnSeveralSprints: false, hideSubtasksOfCards: true },
  estimationField: null, originalEstimationField: null,
  status: { valid: true, hasJobs: false, errors: [], warnings: [] },
};

export const SPRINT_DTO = { id: "sprint-x-id", name: "Iteration X", goal: "Goal X", start: 10, finish: 20, archived: false, isDefault: false };
export const ACTIVITY_DTO = { id: "activity-x-id", $type: "CustomFieldActivityItem", timestamp: 30, author: USER_DTO, category: { id: "CustomFieldCategory" }, field: { id: "field-x-id", name: "Workflow X", $type: "CustomField" }, targetMember: "customFields", added: { id: "value-b", name: "Value B", $type: "EnumBundleElement" }, removed: { id: "value-a", name: "Value A", $type: "EnumBundleElement" } };

/** Neutral execute-plan fixtures shared by the transport contract suite. */
export function executePlanIssueDto(
  id: string,
  summary = `Issue ${id}`,
  updated = 20,
  customFields: readonly unknown[] = [],
) {
  return {
    ...ISSUE_DTO,
    id,
    idReadable: `QP-${id}`,
    summary,
    updated,
    customFields,
  };
}

export const EXECUTE_PLAN_TAG_DTO = {
  id: "tag-q-id",
  name: "Synthetic marker Q",
  owner: USER_DTO,
};

export const EXECUTE_PLAN_LINK_TYPE_DTO = {
  id: "link-q-id",
  name: "Synthetic relation Q",
  directed: true,
  aggregation: false,
  sourceToTarget: "relates outward Q",
  targetToSource: "relates inward Q",
};

export function executePlanLinkContainerDto(
  id: string,
  direction: "OUTWARD" | "INWARD" = "OUTWARD",
) {
  return {
    id,
    direction,
    linkType: EXECUTE_PLAN_LINK_TYPE_DTO,
  };
}
