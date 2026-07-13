import type { IssueSelector, PageRequest, ProjectSelector } from "../../../src/domain/identifiers.js";
import type { IssueSection, IssueSnapshot, TagSummary, UserSummary } from "../../../src/domain/issue.js";
import type { IssueReference, LinkSnapshot, LinkTypeDefinition } from "../../../src/domain/links.js";
import type { FieldDefinition, ProjectSummary } from "../../../src/domain/project-schema.js";
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

  public createIssue(command: CreateIssueCommand): Promise<MutationWriteReceipt> {
    void command;
    return Promise.reject(new Error("FakeGateway createIssue is not configured"));
  }

  public updateIssue(issue: IssueSelector, command: UpdateIssueCommand): Promise<MutationWriteReceipt> {
    void issue;
    void command;
    return Promise.reject(new Error("FakeGateway updateIssue is not configured"));
  }
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
