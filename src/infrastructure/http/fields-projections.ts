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

export const AGILE_PROJECT_FIELDS = "id,shortName,name,archived";
export const AGILE_LIST_FIELDS = `id,name,projects(${AGILE_PROJECT_FIELDS}),status(valid)`;
const ENTITY_VALUE_FIELDS = "id,name,login,idReadable,$type";
export const AGILE_DETAILS_FIELDS = [
  AGILE_LIST_FIELDS,
  `owner(${USER_FIELDS})`,
  `currentSprint(${ENTITY_VALUE_FIELDS})`,
  `columnSettings(field(${ENTITY_VALUE_FIELDS}),columns(id,presentation,isResolved,wipLimit(min,max),fieldValues(${ENTITY_VALUE_FIELDS})))`,
  `swimlaneSettings(id,enabled,$type,field(${ENTITY_VALUE_FIELDS}),values(${ENTITY_VALUE_FIELDS}))`,
  "hideOrphansSwimlane,orphansAtTheTop",
  `sprintsSettings(disableSprints,isExplicit,explicitQuery,cardOnSeveralSprints,sprintSyncField(${ENTITY_VALUE_FIELDS}),defaultSprint(${ENTITY_VALUE_FIELDS}),hideSubtasksOfCards)`,
  `estimationField(${ENTITY_VALUE_FIELDS}),originalEstimationField(${ENTITY_VALUE_FIELDS})`,
  "status(valid,hasJobs,errors,warnings)",
].join(",");
export const SPRINT_FIELDS = "id,name,goal,start,finish,archived,isDefault";
export const TEAM_USER_FIELDS = USER_FIELDS;
export const TEAM_GROUP_FIELDS = "id,name,ringId,usersCount,allUsersGroup";
export const ASSIGNED_ROLE_FIELDS = "id,role(id,name,description),holder(id,$type),scope(id,$type,project(id))";
export const ACTIVITY_FIELDS = `id,$type,timestamp,author(${USER_FIELDS}),category(id),field(${ENTITY_VALUE_FIELDS}),targetMember,added(id,name,login,idReadable,$type),removed(id,name,login,idReadable,$type)`;
