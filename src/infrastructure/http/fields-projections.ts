export const USER_FIELDS = "id,login,name,fullName,email,banned";
export const PROJECT_FIELDS = "id,shortName,name,archived";
export const TAG_FIELDS = `id,name,owner(${USER_FIELDS})`;
export const LINK_TYPE_FIELDS =
  "id,name,localizedName,directed,aggregation,sourceToTarget,targetToSource,localizedSourceToTarget,localizedTargetToSource";
export const ISSUE_REFERENCE_FIELDS = "id,idReadable,summary";
export const PROJECT_FIELD_FIELDS =
  "id,$type,canBeEmpty,isPublic,field(id,name,fieldType(id,valueType))";
export const ALLOWED_VALUE_FIELDS =
  "id,name,localizedName,isResolved,description,$type,login,fullName,banned";
export const PROJECT_FIELD_WITH_BUNDLE_FIELDS =
  `${PROJECT_FIELD_FIELDS},defaultValues(${ALLOWED_VALUE_FIELDS}),bundle(id,$type,values(${ALLOWED_VALUE_FIELDS}),aggregatedUsers(${USER_FIELDS}))`;
export const ISSUE_CUSTOM_FIELD_FIELDS =
  `id,name,$type,value(id,name,localizedName,login,fullName,email,banned,isResolved,$type),projectCustomField(${PROJECT_FIELD_WITH_BUNDLE_FIELDS})`;
export const ISSUE_LINK_FIELDS =
  `id,direction,linkType(${LINK_TYPE_FIELDS}),issues(${ISSUE_REFERENCE_FIELDS})`;
export const ISSUE_LINK_CONTAINER_FIELDS =
  `id,direction,linkType(${LINK_TYPE_FIELDS})`;
export const ISSUE_FIELDS =
  `id,idReadable,summary,description,created,updated,resolved,project(${PROJECT_FIELDS}),reporter(${USER_FIELDS}),updater(${USER_FIELDS}),customFields(${ISSUE_CUSTOM_FIELD_FIELDS})`;
