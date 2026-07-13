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
    values: [{ id: "choice-x-id", name: "Choice X", $type: "EnumBundleElement" }],
  },
};
