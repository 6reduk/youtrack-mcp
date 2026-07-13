import type { IssueSelector, LinkDirection, LinkTypeSelector, PageRequest, ProjectSelector, UserSelector } from "../domain/identifiers.js";
import type { IssueSection, IssueSnapshot, TagSummary, UserSummary } from "../domain/issue.js";
import type { IssueReference, LinkSnapshot, LinkTypeDefinition } from "../domain/links.js";
import type { FieldDefinition, ProjectSummary, SchemaSource } from "../domain/project-schema.js";

export interface SerializedCustomFieldChange {
  readonly id: string;
  readonly name: string;
  readonly $type: string;
  readonly value: unknown;
}

export interface CreateIssueCommand {
  readonly projectId: string;
  readonly summary: string;
  readonly description: string;
  readonly customFields: readonly SerializedCustomFieldChange[];
}

export interface UpdateIssueCommand {
  readonly summary?: string;
  readonly description?: string | null;
  readonly customFields?: readonly SerializedCustomFieldChange[];
}

export interface MutationWriteReceipt {
  readonly issueId: string;
  readonly issueIdReadable: string | null;
}

export interface LinkContainerReference {
  readonly id: string;
  readonly linkTypeId: string;
  readonly direction: LinkDirection;
}

export interface CreateTagCommand {
  readonly name: string;
  readonly ownerId: string;
}

export interface PageSlice<T> {
  readonly items: readonly T[];
  readonly hasMore: boolean;
}

export interface ServerFacts {
  readonly baseUrl: string;
  readonly apiUrl: string;
  readonly version: string | null;
  readonly currentUser: UserSummary;
}

export interface ConnectionConfigView {
  readonly baseUrl: string;
  readonly tokenConfigured: boolean;
  readonly projectSelection: "explicit";
  readonly defaultProject: null;
  readonly requestTimeoutMs: number;
  readonly logLevel: string;
  readonly insecureHttpAllowed: boolean;
}

export interface SchemaFragment {
  readonly source: SchemaSource;
  readonly schemaComplete: boolean;
  readonly fields: readonly FieldDefinition[];
}

export interface ProbeSchemaFragment extends SchemaFragment {
  readonly issueId: string;
  readonly projectId: string;
}

export interface ProjectListQuery {
  readonly page: PageRequest;
  readonly query?: string;
  readonly includeArchived: boolean;
}

export interface IssueSearchQuery {
  readonly query: string;
  readonly page: PageRequest;
  readonly sections: readonly IssueSection[];
}

export interface TagListQuery {
  readonly page: PageRequest;
  readonly query?: string;
}

export interface UserListQuery {
  readonly page: PageRequest;
  readonly selector?: UserSelector;
  readonly query?: string;
  readonly includeBanned: boolean;
}

export interface RelatedIssuesQuery {
  readonly issue: IssueSelector;
  readonly linkType: LinkTypeSelector;
  readonly direction: LinkDirection;
  readonly page: PageRequest;
}

export interface YouTrackGateway {
  getServerFacts(): Promise<ServerFacts>;
  listProjects(query: ProjectListQuery): Promise<PageSlice<ProjectSummary>>;
  findProjects(selector: ProjectSelector): Promise<readonly ProjectSummary[]>;
  getAdminProjectSchema(project: ProjectSummary): Promise<SchemaFragment>;
  getProbeProjectSchema(issue: IssueSelector): Promise<ProbeSchemaFragment | null>;
  getIssue(issue: IssueSelector, sections: readonly IssueSection[]): Promise<IssueSnapshot | null>;
  searchIssues(query: IssueSearchQuery): Promise<PageSlice<IssueSnapshot>>;
  listIssueLinks(issue: IssueSelector, page: PageRequest): Promise<PageSlice<LinkSnapshot>>;
  listIssueTags(issue: IssueSelector, page: PageRequest): Promise<PageSlice<TagSummary>>;
  listTags(query: TagListQuery): Promise<PageSlice<TagSummary>>;
  listLinkTypes(page: PageRequest): Promise<PageSlice<LinkTypeDefinition>>;
  listRelatedIssues(query: RelatedIssuesQuery): Promise<PageSlice<IssueReference>>;
  findUsers(query: UserListQuery): Promise<PageSlice<UserSummary>>;
  createIssue(command: CreateIssueCommand): Promise<MutationWriteReceipt>;
  updateIssue(issue: IssueSelector, command: UpdateIssueCommand): Promise<MutationWriteReceipt>;
  listLinkContainers(issue: IssueSelector): Promise<readonly LinkContainerReference[]>;
  addIssueLink(issue: IssueSelector, containerId: string, targetIssueId: string): Promise<void>;
  removeIssueLink(issue: IssueSelector, containerId: string, targetIssueId: string): Promise<void>;
  addIssueTag(issue: IssueSelector, tagId: string): Promise<void>;
  removeIssueTag(issue: IssueSelector, tagId: string): Promise<void>;
  createTag(command: CreateTagCommand): Promise<TagSummary>;
}

export interface ConnectionConfigReader {
  readConnectionConfig(): ConnectionConfigView;
}

export interface IdGenerator {
  nextId(): string;
}

export interface LoggerPort {
  error(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  info(message: string, details?: unknown): void;
  debug(message: string, details?: unknown): void;
}

export interface ReadContext {
  readonly gateway: YouTrackGateway;
  readonly connectionConfig: ConnectionConfigReader;
  readonly ids: IdGenerator;
  readonly logger: LoggerPort;
}

export type MutationContext = ReadContext;

export interface FindUsersInput {
  readonly selector?: UserSelector;
  readonly query?: string;
  readonly page: PageRequest;
  readonly includeBanned: boolean;
}
