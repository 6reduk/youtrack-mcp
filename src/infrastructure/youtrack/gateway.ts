import { randomUUID } from "node:crypto";
import type {
  IssueSearchQuery,
  PageSlice,
  ProbeSchemaFragment,
  ProjectListQuery,
  RelatedIssuesQuery,
  SchemaFragment,
  ServerFacts,
  TagListQuery,
  UserListQuery,
  YouTrackGateway,
  CreateIssueCommand,
  MutationWriteReceipt,
  UpdateIssueCommand,
  CreateTagCommand,
  LinkContainerReference,
} from "../../application/ports.js";
import { getSelectorEntry, type IssueSelector, type PageRequest, type ProjectSelector } from "../../domain/identifiers.js";
import type { IssueSection, IssueSnapshot, TagSummary, UserSummary } from "../../domain/issue.js";
import type { IssueReference, LinkSnapshot, LinkTypeDefinition } from "../../domain/links.js";
import type { ProjectSummary } from "../../domain/project-schema.js";
import { YouTrackHttpError } from "../http/error-mapper.js";
import {
  ISSUE_FIELDS,
  ISSUE_LINK_CONTAINER_FIELDS,
  LINK_TYPE_FIELDS,
  PROJECT_FIELDS,
  TAG_FIELDS,
  USER_FIELDS,
} from "../http/fields-projections.js";
import type { YouTrackHttpClient } from "../http/youtrack-http-client.js";
import type { IssueDto, IssueLinkDto, LinkTypeDto, ProjectDto, TagDto, UserDto } from "./dtos.js";
import { mapIssue, mapIssueReference, mapLinkContainer, mapLinkType, mapProject, mapProjectField, mapTag, mapUser } from "./mappers.js";
import { discoverAdminSchema } from "./schema-discovery.js";

function page<T>(items: readonly T[], top: number): PageSlice<T> {
  return { items: items.slice(0, top), hasMore: items.length > top };
}

function issuePath(selector: IssueSelector): string {
  return `issues/${encodeURIComponent(getSelectorEntry(selector, ["id", "idReadable"]).value)}`;
}

function sameProject(project: ProjectSummary, selector: ProjectSelector): boolean {
  const entry = getSelectorEntry(selector, ["id", "shortName"]);
  return project[entry.key] === entry.value;
}

export class RestYouTrackGateway implements YouTrackGateway {
  readonly #http: YouTrackHttpClient;
  readonly #baseUrl: URL;

  public constructor(http: YouTrackHttpClient, baseUrl: URL) {
    this.#http = http;
    this.#baseUrl = new URL(baseUrl.href);
  }

  public async getServerFacts(): Promise<ServerFacts> {
    const currentUser = await this.#http.getJson<UserDto>("users/me", { fields: USER_FIELDS }, randomUUID());
    return {
      baseUrl: this.#baseUrl.href,
      apiUrl: new URL("api", this.#baseUrl).href,
      version: null,
      currentUser: mapUser(currentUser),
    };
  }

  public async listProjects(query: ProjectListQuery): Promise<PageSlice<ProjectSummary>> {
    const raw = await this.#http.getJson<ProjectDto[]>("admin/projects", {
      fields: PROJECT_FIELDS,
      $skip: query.page.skip,
      $top: query.page.top + 1,
      ...(query.query === undefined ? {} : { query: query.query }),
    }, randomUUID());
    const mapped = raw.map((item) => mapProject(item, this.#baseUrl));
    const filtered = query.includeArchived ? mapped : mapped.filter((item) => !item.archived);
    return { items: filtered.slice(0, query.page.top), hasMore: raw.length > query.page.top };
  }

  public async findProjects(selector: ProjectSelector): Promise<readonly ProjectSummary[]> {
    const entry = getSelectorEntry(selector, ["id", "shortName"]);
    try {
      const raw = await this.#http.getJson<ProjectDto>(
        `admin/projects/${encodeURIComponent(entry.value)}`,
        { fields: PROJECT_FIELDS },
        randomUUID(),
      );
      const mapped = mapProject(raw, this.#baseUrl);
      return sameProject(mapped, selector) ? [mapped] : [];
    } catch (error: unknown) {
      if (error instanceof YouTrackHttpError && error.kind === "upstream_not_found") return [];
      throw error;
    }
  }

  public async getAdminProjectSchema(project: ProjectSummary): Promise<SchemaFragment> {
    return discoverAdminSchema(this.#http, project, randomUUID());
  }

  public async getProbeProjectSchema(issue: IssueSelector): Promise<ProbeSchemaFragment | null> {
    try {
      const raw = await this.#http.getJson<IssueDto>(issuePath(issue), {
        fields: ISSUE_FIELDS,
      }, randomUUID());
      if (raw.project == null) return null;
      const project = mapProject(raw.project, this.#baseUrl);
      const fields = (raw.customFields ?? []).flatMap((field) =>
        field.projectCustomField == null
          ? []
          : [mapProjectField(field.projectCustomField, "probe_issue", false)],
      );
      const issueId = typeof raw.idReadable === "string"
        ? raw.idReadable
        : typeof raw.id === "string" ? raw.id : "";
      return {
        issueId,
        projectId: project.id,
        source: { kind: "probe_issue", outcome: fields.length === 0 ? "empty" : "partial" },
        schemaComplete: false,
        fields,
      };
    } catch (error: unknown) {
      if (error instanceof YouTrackHttpError && error.kind === "upstream_not_found") return null;
      throw error;
    }
  }

  public async getIssue(issue: IssueSelector, sections: readonly IssueSection[]): Promise<IssueSnapshot | null> {
    try {
      const raw = await this.#http.getJson<IssueDto>(issuePath(issue), { fields: ISSUE_FIELDS }, randomUUID());
      const tags = sections.includes("tags") ? (await this.listIssueTags(issue, { skip: 0, top: 100 })).items : [];
      const links = sections.includes("links") ? (await this.listIssueLinks(issue, { skip: 0, top: 100 })).items : [];
      return mapIssue(raw, this.#baseUrl, tags, links);
    } catch (error: unknown) {
      if (error instanceof YouTrackHttpError && error.kind === "upstream_not_found") return null;
      throw error;
    }
  }

  public async searchIssues(query: IssueSearchQuery): Promise<PageSlice<IssueSnapshot>> {
    const raw = await this.#http.getJson<IssueDto[]>("issues", {
      fields: ISSUE_FIELDS,
      query: query.query,
      $skip: query.page.skip,
      $top: query.page.top + 1,
    }, randomUUID());
    return page(raw.map((item) => mapIssue(item, this.#baseUrl)), query.page.top);
  }

  public async listIssueLinks(issue: IssueSelector, requested: PageRequest): Promise<PageSlice<LinkSnapshot>> {
    const baseRaw = await this.#http.getJson<IssueDto>(issuePath(issue), {
      fields: "id,idReadable,summary",
    }, randomUUID());
    const base = mapIssueReference(baseRaw, this.#baseUrl);
    const needed = requested.skip + requested.top + 1;
    const links: LinkSnapshot[] = [];
    const containerPageSize = 100;
    for (let containerSkip = 0; links.length < needed; containerSkip += containerPageSize) {
      const containers = await this.#http.getJson<IssueLinkDto[]>(`${issuePath(issue)}/links`, {
        fields: ISSUE_LINK_CONTAINER_FIELDS,
        $skip: containerSkip,
        $top: containerPageSize,
      }, randomUUID());
      for (const container of containers) {
        if (links.length >= needed) break;
        const containerId = typeof container.id === "string" ? container.id : null;
        if (containerId === null) continue;
        for (let relatedSkip = 0; links.length < needed; relatedSkip += 100) {
          const related = await this.#http.getJson<IssueDto[]>(
            `${issuePath(issue)}/links/${encodeURIComponent(containerId)}/issues`,
            { fields: "id,idReadable,summary", $skip: relatedSkip, $top: 100 },
            randomUUID(),
          );
          links.push(...mapLinkContainer(base, { ...container, issues: related }, this.#baseUrl));
          if (related.length < 100) break;
        }
      }
      if (containers.length < containerPageSize) break;
    }
    return page(links.slice(requested.skip), requested.top);
  }

  public async listIssueTags(issue: IssueSelector, requested: PageRequest): Promise<PageSlice<TagSummary>> {
    const raw = await this.#http.getJson<TagDto[]>(`${issuePath(issue)}/tags`, {
      fields: TAG_FIELDS,
      $skip: requested.skip,
      $top: requested.top + 1,
    }, randomUUID());
    return page(raw.map((item) => mapTag(item, this.#baseUrl)), requested.top);
  }

  public async listTags(query: TagListQuery): Promise<PageSlice<TagSummary>> {
    const raw = await this.#http.getJson<TagDto[]>("tags", {
      fields: TAG_FIELDS,
      $skip: query.page.skip,
      $top: query.page.top + 1,
      ...(query.query === undefined ? {} : { query: query.query }),
    }, randomUUID());
    return page(raw.map((item) => mapTag(item, this.#baseUrl)), query.page.top);
  }

  public async listLinkTypes(requested: PageRequest): Promise<PageSlice<LinkTypeDefinition>> {
    const raw = await this.#http.getJson<LinkTypeDto[]>("issueLinkTypes", {
      fields: LINK_TYPE_FIELDS,
      $skip: requested.skip,
      $top: requested.top + 1,
    }, randomUUID());
    return page(raw.map(mapLinkType), requested.top);
  }

  public async listRelatedIssues(query: RelatedIssuesQuery): Promise<PageSlice<IssueReference>> {
    const links = await this.listIssueLinks(query.issue, { skip: 0, top: 100 });
    const selector = getSelectorEntry(query.linkType, ["id", "exactName"]);
    const matches = links.items.filter((link) =>
      link.direction === query.direction &&
      (selector.key === "id" ? link.type.id === selector.value : link.type.name === selector.value));
    const related = matches.map((link) => query.direction === "source_to_target" ? link.target : link.source);
    return page(related.slice(query.page.skip), query.page.top);
  }

  public async findUsers(query: UserListQuery): Promise<PageSlice<UserSummary>> {
    const selector = query.selector === undefined ? null : getSelectorEntry(query.selector, ["id", "login", "email"]);
    if (selector !== null && selector.key !== "email") {
      try {
        const raw = await this.#http.getJson<UserDto>(`users/${encodeURIComponent(selector.value)}`, { fields: USER_FIELDS }, randomUUID());
        const user = mapUser(raw);
        const exact = selector.key === "id" ? user.id === selector.value : user.login === selector.value;
        return { items: exact && (query.includeBanned || user.banned !== true) ? [user] : [], hasMore: false };
      } catch (error: unknown) {
        if (error instanceof YouTrackHttpError && error.kind === "upstream_not_found") return { items: [], hasMore: false };
        throw error;
      }
    }
    const raw = await this.#http.getJson<UserDto[]>("users", {
      fields: USER_FIELDS,
      $skip: query.page.skip,
      $top: query.page.top + 1,
      ...(query.query === undefined ? {} : { query: query.query }),
    }, randomUUID());
    let users = raw.map(mapUser);
    if (!query.includeBanned) users = users.filter((user) => user.banned !== true);
    if (selector?.key === "email") users = users.filter((user) => user.email === selector.value);
    return { items: users.slice(0, query.page.top), hasMore: raw.length > query.page.top };
  }

  public async createIssue(command: CreateIssueCommand): Promise<MutationWriteReceipt> {
    const raw = await this.#http.requestJson<IssueDto>({
      method: "POST",
      path: "issues",
      query: { fields: "id,idReadable" },
      requestId: randomUUID(),
      body: {
        project: { id: command.projectId },
        summary: command.summary,
        description: command.description,
        ...(command.customFields.length === 0 ? {} : { customFields: command.customFields }),
      },
    });
    return {
      issueId: typeof raw.id === "string" ? raw.id : "",
      issueIdReadable: typeof raw.idReadable === "string" ? raw.idReadable : null,
    };
  }

  public async updateIssue(
    issue: IssueSelector,
    command: UpdateIssueCommand,
  ): Promise<MutationWriteReceipt> {
    const raw = await this.#http.requestJson<IssueDto>({
      method: "POST",
      path: issuePath(issue),
      query: { fields: "id,idReadable" },
      requestId: randomUUID(),
      body: command,
    });
    return {
      issueId: typeof raw.id === "string" ? raw.id : getSelectorEntry(issue, ["id", "idReadable"]).value,
      issueIdReadable: typeof raw.idReadable === "string" ? raw.idReadable : null,
    };
  }

  public async listLinkContainers(issue: IssueSelector): Promise<readonly LinkContainerReference[]> {
    const result: LinkContainerReference[] = [];
    for (let skip = 0; ; skip += 100) {
      const raw = await this.#http.getJson<IssueLinkDto[]>(`${issuePath(issue)}/links`, {
        fields: ISSUE_LINK_CONTAINER_FIELDS, $skip: skip, $top: 100,
      }, randomUUID());
      for (const item of raw) {
        if (typeof item.id !== "string" || typeof item.linkType?.id !== "string") continue;
        const direction = item.direction === "INWARD" ? "target_to_source" : "source_to_target";
        result.push({ id: item.id, linkTypeId: item.linkType.id, direction });
      }
      if (raw.length < 100) return result;
    }
  }

  public async addIssueLink(issue: IssueSelector, containerId: string, targetIssueId: string): Promise<void> {
    await this.#http.requestJson({ method: "POST", path: `${issuePath(issue)}/links/${encodeURIComponent(containerId)}/issues`, requestId: randomUUID(), body: { id: targetIssueId } });
  }

  public async removeIssueLink(issue: IssueSelector, containerId: string, targetIssueId: string): Promise<void> {
    await this.#http.requestJson({ method: "DELETE", path: `${issuePath(issue)}/links/${encodeURIComponent(containerId)}/issues/${encodeURIComponent(targetIssueId)}`, requestId: randomUUID() });
  }

  public async addIssueTag(issue: IssueSelector, tagId: string): Promise<void> {
    await this.#http.requestJson({ method: "POST", path: `${issuePath(issue)}/tags`, requestId: randomUUID(), body: { id: tagId } });
  }

  public async removeIssueTag(issue: IssueSelector, tagId: string): Promise<void> {
    await this.#http.requestJson({ method: "DELETE", path: `${issuePath(issue)}/tags/${encodeURIComponent(tagId)}`, requestId: randomUUID() });
  }

  public async createTag(command: CreateTagCommand): Promise<TagSummary> {
    const raw = await this.#http.requestJson<TagDto>({ method: "POST", path: "tags", query: { fields: TAG_FIELDS }, requestId: randomUUID(), body: { name: command.name, owner: { id: command.ownerId } } });
    return mapTag(raw, this.#baseUrl);
  }
}
