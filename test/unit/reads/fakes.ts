import type { IssueSelector, PageRequest, ProjectSelector } from "../../../src/domain/identifiers.js";
import type { IssueSection, IssueSnapshot, TagSummary, UserSummary } from "../../../src/domain/issue.js";
import type { IssueReference, LinkSnapshot, LinkTypeDefinition } from "../../../src/domain/links.js";
import type { FieldDefinition, ProjectSummary } from "../../../src/domain/project-schema.js";
import type { AgileBoardDetails, AgileBoardSelector, AgileBoardSummary, IssueActivitySummary, ProjectTeamSnapshot, SprintSummary } from "../../../src/domain/agile-audit.js";
import type {
  CreateIssueCommand,
  ConnectionConfigReader,
  ConnectionConfigView,
  IdGenerator,
  IssueSearchQuery,
  LoggerPort,
  PageSlice,
  ProbeSchemaFragment,
  ProjectListQuery,
  ReadContext,
  RelatedIssuesQuery,
  SchemaFragment,
  ServerFacts,
  TagListQuery,
  UserListQuery,
  YouTrackGateway,
  MutationWriteReceipt,
  UpdateIssueCommand,
  CreateTagCommand,
  LinkContainerReference,
  AgileBoardListQuery,
  SprintListQuery,
  ProjectTeamQuery,
  IssueActivityQuery,
} from "../../../src/application/ports.js";

export const PROJECT_A: ProjectSummary = {
  id: "project-a-id",
  shortName: "ALPHA",
  name: "Alpha project",
  archived: false,
  url: "https://tracker.example.test/projects/alpha",
};

export const USER_A: UserSummary = {
  id: "user-a-id",
  login: "alpha.user",
  name: "Alpha User",
  email: "alpha@example.test",
  banned: false,
};

export const FIELD_A: FieldDefinition = {
  id: "field-a-id",
  name: "Arbitrary A",
  fieldType: "SyntheticEnumField",
  valueType: "enum",
  valueShape: "entity",
  cardinality: "single",
  required: true,
  writability: "writable",
  valuesComplete: true,
  allowedValues: [{ id: "value-a-id", name: "Value A", kind: "enum" }],
  provenance: ["admin_project_fields"],
};

export const ISSUE_A: IssueSnapshot = {
  id: "issue-a-id",
  idReadable: "ALPHA-1",
  url: "https://tracker.example.test/issue/ALPHA-1",
  summary: "Exact summary",
  description: "Unchanged markdown",
  project: PROJECT_A,
  reporter: USER_A,
  creator: USER_A,
  updater: USER_A,
  createdAt: 1,
  updatedAt: 2,
  resolvedAt: null,
  customFields: [],
  tags: [],
  links: [],
};

export const TAG_A: TagSummary = {
  id: "tag-a-id",
  name: "Exact tag",
  url: null,
  owner: USER_A,
};

export const LINK_TYPE_A: LinkTypeDefinition = {
  id: "link-type-a-id",
  name: "Arbitrary relation",
  directed: true,
  aggregation: false,
  sourceToTargetName: "forward label",
  targetToSourceName: "reverse label",
  localizedNames: [],
};

export const ISSUE_REFERENCE_A: IssueReference = {
  id: ISSUE_A.id,
  idReadable: ISSUE_A.idReadable,
  summary: ISSUE_A.summary,
  url: ISSUE_A.url,
};

export const BOARD_A: AgileBoardDetails = {
  id: "board-a-id", name: "Alpha board", projects: [PROJECT_A], archived: null, available: true,
  url: "https://tracker.example.test/agiles/board-a-id", owner: USER_A,
  columnField: { id: "field-column-id", name: "Arbitrary column", login: null, idReadable: null, type: "CustomField" },
  columns: [], swimlanes: null, orphanSwimlane: { hidden: false, atTop: false },
  sprintSettings: null, currentSprint: { id: "sprint-a-id", name: "Iteration A", login: null, idReadable: null, type: "Sprint" },
  estimationField: null, originalEstimationField: null, cardFields: null,
  status: { valid: true, hasJobs: false, errors: [], warnings: [] },
};
export const SPRINT_A: SprintSummary = { id: "sprint-a-id", name: "Iteration A", goal: null, startAt: 1, finishAt: 2, archived: false, current: true, isDefault: false };
export const ACTIVITY_A: IssueActivitySummary = { id: "activity-a-id", type: "CustomFieldActivityItem", category: "CustomFieldCategory", timestamp: 3, author: USER_A, field: { id: "field-a-id", name: "Arbitrary A", login: null, idReadable: null, type: "CustomField" }, targetMember: "customFields", added: { id: "value-a", name: "Value A", login: null, idReadable: null, type: "EnumBundleElement" }, removed: null };

export class FakeGateway implements YouTrackGateway {
  public serverFacts: ServerFacts = {
    baseUrl: "https://tracker.example.test/",
    apiUrl: "https://tracker.example.test/api",
    version: null,
    currentUser: USER_A,
  };
  public projects: readonly ProjectSummary[] = [PROJECT_A];
  public adminSchema: SchemaFragment = {
    source: { kind: "admin_project_fields", outcome: "ok" },
    schemaComplete: true,
    fields: [FIELD_A],
  };
  public probeSchema: ProbeSchemaFragment | null = null;
  public issue: IssueSnapshot | null = ISSUE_A;
  public issues: PageSlice<IssueSnapshot> = { items: [ISSUE_A], hasMore: false };
  public links: PageSlice<LinkSnapshot> = { items: [], hasMore: false };
  public tags: PageSlice<TagSummary> = { items: [TAG_A], hasMore: false };
  public linkTypes: PageSlice<LinkTypeDefinition> = { items: [LINK_TYPE_A], hasMore: false };
  public relatedIssues: PageSlice<IssueReference> = {
    items: [ISSUE_REFERENCE_A],
    hasMore: false,
  };
  public users: PageSlice<UserSummary> = { items: [USER_A], hasMore: false };
  public boards: PageSlice<AgileBoardSummary> = { items: [BOARD_A], hasMore: false };
  public board: AgileBoardDetails | null = BOARD_A;
  public sprints: PageSlice<SprintSummary> = { items: [SPRINT_A], hasMore: false };
  public activities: PageSlice<IssueActivitySummary> = { items: [ACTIVITY_A], hasMore: false };
  public lastProjectListQuery: ProjectListQuery | null = null;
  public lastSearchQuery: IssueSearchQuery | null = null;
  public lastRelatedQuery: RelatedIssuesQuery | null = null;
  public lastTagListQuery: TagListQuery | null = null;
  public lastUserListQuery: UserListQuery | null = null;
  public probeSchemaCalls = 0;

  public async getServerFacts(): Promise<ServerFacts> {
    return Promise.resolve(this.serverFacts);
  }

  public async listProjects(query: ProjectListQuery): Promise<PageSlice<ProjectSummary>> {
    this.lastProjectListQuery = query;
    return Promise.resolve({ items: this.projects, hasMore: false });
  }

  public async findProjects(selector: ProjectSelector): Promise<readonly ProjectSummary[]> {
    void selector;
    return Promise.resolve(this.projects);
  }

  public async getAdminProjectSchema(project: ProjectSummary): Promise<SchemaFragment> {
    void project;
    return Promise.resolve(this.adminSchema);
  }

  public async getProbeProjectSchema(issue: IssueSelector): Promise<ProbeSchemaFragment | null> {
    void issue;
    this.probeSchemaCalls += 1;
    return Promise.resolve(this.probeSchema);
  }

  public async getIssue(
    issue: IssueSelector,
    sections: readonly IssueSection[],
  ): Promise<IssueSnapshot | null> {
    void issue;
    void sections;
    return Promise.resolve(this.issue);
  }

  public async searchIssues(query: IssueSearchQuery): Promise<PageSlice<IssueSnapshot>> {
    this.lastSearchQuery = query;
    return Promise.resolve(this.issues);
  }

  public async listIssueLinks(
    issue: IssueSelector,
    page: PageRequest,
  ): Promise<PageSlice<LinkSnapshot>> {
    void issue;
    void page;
    return Promise.resolve(this.links);
  }

  public async listIssueTags(
    issue: IssueSelector,
    page: PageRequest,
  ): Promise<PageSlice<TagSummary>> {
    void issue;
    void page;
    return Promise.resolve(this.tags);
  }

  public async listTags(query: TagListQuery): Promise<PageSlice<TagSummary>> {
    this.lastTagListQuery = query;
    return Promise.resolve(this.tags);
  }

  public async listLinkTypes(page: PageRequest): Promise<PageSlice<LinkTypeDefinition>> {
    void page;
    return Promise.resolve(this.linkTypes);
  }

  public async listRelatedIssues(query: RelatedIssuesQuery): Promise<PageSlice<IssueReference>> {
    this.lastRelatedQuery = query;
    return Promise.resolve(this.relatedIssues);
  }

  public async findUsers(query: UserListQuery): Promise<PageSlice<UserSummary>> {
    this.lastUserListQuery = query;
    return Promise.resolve(this.users);
  }

  public listAgileBoards(query: AgileBoardListQuery): Promise<PageSlice<AgileBoardSummary>> { void query; return Promise.resolve(this.boards); }
  public findAgileBoards(selector: AgileBoardSelector): Promise<readonly AgileBoardSummary[]> { void selector; return Promise.resolve(this.boards.items); }
  public getAgileBoard(boardId: string): Promise<AgileBoardDetails | null> { void boardId; return Promise.resolve(this.board); }
  public listSprints(query: SprintListQuery): Promise<PageSlice<SprintSummary>> { void query; return Promise.resolve(this.sprints); }
  public getProjectTeam(query: ProjectTeamQuery): Promise<ProjectTeamSnapshot> { return Promise.resolve({ project: query.project, users: [{ ...USER_A, membership: "direct", roles: [] }], groups: [], usersPage: { skip: query.page.skip, requestedTop: query.page.top, returned: 1, hasMore: false }, groupsPage: { skip: query.page.skip, requestedTop: query.page.top, returned: 0, hasMore: false }, teamRoles: [], rolesAvailable: true, warnings: [] }); }
  public listIssueActivities(query: IssueActivityQuery): Promise<PageSlice<IssueActivitySummary>> { void query; return Promise.resolve(this.activities); }

  public createIssue(command: CreateIssueCommand): Promise<MutationWriteReceipt> {
    void command;
    return Promise.reject(new Error("FakeGateway createIssue is not configured"));
  }

  public updateIssue(issue: IssueSelector, command: UpdateIssueCommand): Promise<MutationWriteReceipt> {
    void issue;
    void command;
    return Promise.reject(new Error("FakeGateway updateIssue is not configured"));
  }
  public listLinkContainers(issue: IssueSelector): Promise<readonly LinkContainerReference[]> { void issue; return Promise.resolve([{ id: "container-a", linkTypeId: LINK_TYPE_A.id, direction: "source_to_target" }]); }
  public addIssueLink(issue: IssueSelector, containerId: string, targetIssueId: string): Promise<void> { void issue; void containerId; void targetIssueId; return Promise.reject(new Error("not configured")); }
  public removeIssueLink(issue: IssueSelector, containerId: string, targetIssueId: string): Promise<void> { void issue; void containerId; void targetIssueId; return Promise.reject(new Error("not configured")); }
  public addIssueTag(issue: IssueSelector, tagId: string): Promise<void> { void issue; void tagId; return Promise.reject(new Error("not configured")); }
  public removeIssueTag(issue: IssueSelector, tagId: string): Promise<void> { void issue; void tagId; return Promise.reject(new Error("not configured")); }
  public createTag(command: CreateTagCommand): Promise<TagSummary> { void command; return Promise.reject(new Error("not configured")); }
}

class SequenceIds implements IdGenerator {
  #next = 1;

  public nextId(): string {
    const value = `request-${String(this.#next)}`;
    this.#next += 1;
    return value;
  }
}

class FakeConnectionConfig implements ConnectionConfigReader {
  public readConnectionConfig(): ConnectionConfigView {
    return {
      baseUrl: "https://tracker.example.test/",
      tokenConfigured: true,
      projectSelection: "explicit",
      defaultProject: null,
      requestTimeoutMs: 30_000,
      logLevel: "info",
      insecureHttpAllowed: false,
    };
  }
}

const NULL_LOGGER: LoggerPort = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

export function createReadContext(gateway: YouTrackGateway = new FakeGateway()): ReadContext {
  return {
    gateway,
    connectionConfig: new FakeConnectionConfig(),
    ids: new SequenceIds(),
    logger: NULL_LOGGER,
  };
}
