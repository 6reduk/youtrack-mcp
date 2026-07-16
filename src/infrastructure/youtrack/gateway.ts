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
  AgileBoardListQuery,
  SprintListQuery,
  ProjectTeamQuery,
  IssueActivityQuery,
} from "../../application/ports.js";
import type { AgileBoardSelector, AgileBoardSummary, ProjectTeamMember, ProjectTeamSnapshot } from "../../domain/agile-audit.js";
import { DomainValidationError, getSelectorEntry, type IssueSelector, type PageRequest, type ProjectSelector } from "../../domain/identifiers.js";
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
  ACTIVITY_FIELDS,
  AGILE_DETAILS_FIELDS,
  AGILE_LIST_FIELDS,
  SPRINT_FIELDS,
  TEAM_GROUP_FIELDS,
  TEAM_USER_FIELDS,
  ASSIGNED_ROLE_FIELDS,
} from "../http/fields-projections.js";
import type { YouTrackHttpClient } from "../http/youtrack-http-client.js";
import type { ActivityDto, AgileDto, AssignedRoleDto, HubGroupsDto, HubOwnUsersDto, HubProjectsDto, HubProjectTeamsDto, HubUsersDto, IssueDto, IssueLinkDto, LinkTypeDto, ProjectDto, SprintDto, TagDto, UserDto, UserGroupDto } from "./dtos.js";
import { mapAgileBoardDetails, mapAgileBoardSummary, mapHubProjectTeamGroup, mapHubUser, mapIssue, mapIssueActivity, mapIssueReference, mapLinkContainer, mapLinkType, mapProject, mapProjectField, mapProjectRole, mapProjectTeamGroup, mapSprint, mapTag, mapUser } from "./mappers.js";
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

function partialReadError(error: unknown): boolean {
  return error instanceof YouTrackHttpError &&
    (error.kind === "permission_denied" || error.kind === "upstream_not_found");
}

function hubReadError(kind: "upstream_not_found" | "invalid_response", message: string, requestId: string): YouTrackHttpError {
  return new YouTrackHttpError({ kind, message, status: null, retryable: false, requestId });
}

function hubCollection<T>(value: readonly T[] | undefined, label: string, requestId: string): readonly T[] {
  if (!Array.isArray(value)) throw hubReadError("invalid_response", `Hub response omitted ${label}`, requestId);
  return value as readonly T[];
}

function validTotal(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function hubHasMore(total: unknown, skip: number, returnedWithSentinel: number, top: number): boolean {
  const count = Math.min(returnedWithSentinel, top);
  const knownTotal = validTotal(total);
  return knownTotal === null ? returnedWithSentinel > top : skip + count < knownTotal;
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
    if (links.hasMore) {
      return { items: related.slice(query.page.skip, query.page.skip + query.page.top), hasMore: true };
    }
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

  public async listAgileBoards(query: AgileBoardListQuery): Promise<PageSlice<AgileBoardSummary>> {
    const raw = await this.#http.getJson<AgileDto[]>("agiles", {
      fields: AGILE_LIST_FIELDS,
      $skip: query.page.skip,
      $top: query.page.top + 1,
    }, randomUUID());
    return page(raw.map((item) => mapAgileBoardSummary(item, this.#baseUrl)), query.page.top);
  }

  public async findAgileBoards(selector: AgileBoardSelector): Promise<readonly AgileBoardSummary[]> {
    const entry = getSelectorEntry(selector, ["id", "exactName"]);
    if (entry.key === "id") {
      try {
        const raw = await this.#http.getJson<AgileDto>(`agiles/${encodeURIComponent(entry.value)}`, { fields: AGILE_LIST_FIELDS }, randomUUID());
        const board = mapAgileBoardSummary(raw, this.#baseUrl);
        return board.id === entry.value ? [board] : [];
      } catch (error: unknown) {
        if (error instanceof YouTrackHttpError && error.kind === "upstream_not_found") return [];
        throw error;
      }
    }

    const matches: AgileBoardSummary[] = [];
    const chunk = 100;
    for (let skip = 0; skip <= 100_000; skip += chunk) {
      const raw = await this.#http.getJson<AgileDto[]>("agiles", {
        fields: AGILE_LIST_FIELDS, $skip: skip, $top: chunk,
      }, randomUUID());
      matches.push(...raw.map((item) => mapAgileBoardSummary(item, this.#baseUrl)).filter((board) => board.name === entry.value));
      if (raw.length < chunk) break;
      if (skip === 100_000) throw new DomainValidationError("Agile board exact-name resolution exceeded the bounded discovery limit");
    }
    return matches;
  }

  public async getAgileBoard(boardId: string): Promise<ReturnType<typeof mapAgileBoardDetails> | null> {
    try {
      const raw = await this.#http.getJson<AgileDto>(`agiles/${encodeURIComponent(boardId)}`, { fields: AGILE_DETAILS_FIELDS }, randomUUID());
      return mapAgileBoardDetails(raw, this.#baseUrl);
    } catch (error: unknown) {
      if (error instanceof YouTrackHttpError && error.kind === "upstream_not_found") return null;
      throw error;
    }
  }

  public async listSprints(query: SprintListQuery): Promise<PageSlice<ReturnType<typeof mapSprint>>> {
    const raw = await this.#http.getJson<SprintDto[]>(`agiles/${encodeURIComponent(query.boardId)}/sprints`, {
      fields: SPRINT_FIELDS, $skip: query.page.skip, $top: query.page.top + 1,
    }, randomUUID());
    return page(raw.map((item) => mapSprint(item, query.currentSprintId)), query.page.top);
  }

  public async getProjectTeam(query: ProjectTeamQuery): Promise<ProjectTeamSnapshot> {
    const path = `admin/projects/${encodeURIComponent(query.project.id)}/team`;
    let usersRaw: readonly UserDto[];
    try {
      usersRaw = await this.#http.getJson<UserDto[]>(`${path}/users`, {
        fields: TEAM_USER_FIELDS, $skip: query.page.skip, $top: query.page.top + 1,
      }, randomUUID());
    } catch (error: unknown) {
      if (error instanceof YouTrackHttpError && error.kind === "upstream_not_found") {
        return this.getHubProjectTeam(query);
      }
      throw error;
    }
    const warnings: string[] = [];
    const directIds = new Set<string>();
    let directCompleteness: ProjectTeamSnapshot["completeness"]["directMembership"] = {
      status: "complete", reason: "authoritative_source_exhausted",
    };
    try {
      const chunk = 100;
      for (let skip = 0; skip <= 10_000; skip += chunk) {
        const ownRaw = await this.#http.getJson<UserDto[]>(`${path}/ownUsers`, { fields: "id", $skip: skip, $top: chunk }, randomUUID());
        for (const user of ownRaw) if (typeof user.id === "string") directIds.add(user.id);
        if (ownRaw.length < chunk) break;
        if (skip === 10_000) {
          warnings.push("Direct membership enumeration reached its safety bound; some membership values may be unknown.");
          directCompleteness = { status: "partial", reason: "source_truncated" };
        }
      }
    } catch (error: unknown) {
      if (!partialReadError(error)) throw error;
      warnings.push("Direct membership is unavailable with the current YouTrack version or permissions.");
      directCompleteness = { status: "unavailable", reason: "source_unavailable" };
    }

    let groupsRaw: readonly UserGroupDto[] = [];
    let groupsHasMore = false;
    let groupsCompleteness: ProjectTeamSnapshot["completeness"]["groups"] = {
      status: "complete", reason: "authoritative_source_exhausted",
    };
    try {
      const raw = await this.#http.getJson<UserGroupDto[]>(`${path}/groups`, {
        fields: TEAM_GROUP_FIELDS, $skip: query.page.skip, $top: query.page.top + 1,
      }, randomUUID());
      groupsRaw = raw.slice(0, query.page.top);
      groupsHasMore = raw.length > query.page.top;
    } catch (error: unknown) {
      if (!partialReadError(error)) throw error;
      warnings.push("Project team groups are unavailable with the current YouTrack version or permissions.");
      groupsCompleteness = { status: "unavailable", reason: "source_unavailable" };
    }

    const directKnown = directCompleteness.status === "complete";
    const users: ProjectTeamMember[] = usersRaw.slice(0, query.page.top).map((user) => {
      const mapped = mapUser(user);
      return { ...mapped, membership: directKnown ? (directIds.has(mapped.id) ? "direct" : "via_group") : "unknown", roles: [] };
    });
    const groups = groupsRaw.map(mapProjectTeamGroup);
    let rolesAvailable = true;
    let teamRoles: ReturnType<typeof mapProjectRole>[] | null = null;
    let rolesTruncated = false;
    const roleMap = new Map<string, ReturnType<typeof mapProjectRole>[] | null>();
    let teamId: string | null = null;
    try {
      const team = await this.#http.getJson<{ readonly id?: unknown }>(path, { fields: "id" }, randomUUID());
      teamId = typeof team.id === "string" ? team.id : null;
      if (teamId === null) rolesAvailable = false;
    } catch (error: unknown) {
      if (!partialReadError(error)) throw error;
      rolesAvailable = false;
    }
    for (const holderId of [...users.map((user) => user.id), ...groups.map((group) => group.id), ...(teamId === null ? [] : [teamId])]) {
      try {
        const assigned = await this.#http.getJson<AssignedRoleDto[]>("assignedRoles", {
          fields: ASSIGNED_ROLE_FIELDS, query: `holder:${holderId}`, $skip: 0, $top: 101,
        }, randomUUID());
        if (assigned.length > 100) {
          warnings.push(`Role assignments for holder ${holderId} reached the safety bound and were truncated.`);
          rolesTruncated = true;
        }
        const roles = assigned.slice(0, 100)
          .filter((item) => item.holder?.id === holderId && item.scope?.project?.id === query.project.id)
          .map(mapProjectRole);
        roleMap.set(holderId, roles);
      } catch (error: unknown) {
        if (!partialReadError(error)) throw error;
        rolesAvailable = false;
        roleMap.set(holderId, null);
        break;
      }
    }
    if (!rolesAvailable) warnings.push("Project-scoped role assignments are partially unavailable; reading assigned roles can require Update Project permission and YouTrack 2026.1 or newer.");
    warnings.push("The public project-team API does not expose job titles; no job title is inferred from role assignments.");
    for (let index = 0; index < users.length; index += 1) {
      const user = users[index];
      if (user !== undefined) users[index] = { ...user, roles: roleMap.get(user.id) ?? null };
    }
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      if (group !== undefined) groups[index] = { ...group, roles: roleMap.get(group.id) ?? null };
    }
    if (teamId !== null) teamRoles = roleMap.get(teamId) ?? null;
    return {
      project: query.project,
      users,
      groups,
      usersPage: { skip: query.page.skip, requestedTop: query.page.top, returned: users.length, hasMore: usersRaw.length > query.page.top },
      groupsPage: { skip: query.page.skip, requestedTop: query.page.top, returned: groupsRaw.length, hasMore: groupsHasMore },
      teamRoles,
      rolesAvailable,
      warnings,
      source: "youtrack_project_team",
      completeness: {
        users: { status: "complete", reason: "authoritative_source_exhausted" },
        groups: groupsCompleteness,
        directMembership: directCompleteness,
        roles: !rolesAvailable
          ? { status: "unavailable", reason: "source_unavailable" }
          : rolesTruncated
            ? { status: "partial", reason: "source_truncated" }
            : { status: "complete", reason: "authoritative_source_exhausted" },
      },
    };
  }

  private async getHubProjectTeam(query: ProjectTeamQuery): Promise<ProjectTeamSnapshot> {
    const projectRequestId = randomUUID();
    const projectPage = await this.#http.getHubJson<HubProjectsDto>("projects", {
      fields: "id,key,name", query: `key:${query.project.shortName}`, $skip: 0, $top: 2,
    }, projectRequestId);
    const projects = hubCollection(projectPage.projects, "projects", projectRequestId)
      .filter((project) => project.key === query.project.shortName);
    if (projects.length === 0) {
      throw hubReadError("upstream_not_found", "The corresponding Hub project was not found", projectRequestId);
    }
    if (projects.length !== 1 || typeof projects[0]?.id !== "string") {
      throw hubReadError("invalid_response", "Hub project resolution was ambiguous or invalid", projectRequestId);
    }
    const hubProjectId = projects[0].id;

    const teamRequestId = randomUUID();
    const teamPage = await this.#http.getHubJson<HubProjectTeamsDto>("projectteams", {
      fields: "id,project(id,key)", query: `project:${hubProjectId}`, $skip: 0, $top: 2,
    }, teamRequestId);
    const teams = hubCollection(teamPage.projectteams, "projectteams", teamRequestId)
      .filter((team) => team.project?.id === hubProjectId);
    if (teams.length === 0) {
      throw hubReadError("upstream_not_found", "The corresponding Hub project team was not found", teamRequestId);
    }
    if (teams.length !== 1 || typeof teams[0]?.id !== "string") {
      throw hubReadError("invalid_response", "Hub project-team resolution was ambiguous or invalid", teamRequestId);
    }
    const hubTeamId = teams[0].id;
    const teamPath = `projectteams/${encodeURIComponent(hubTeamId)}`;

    const usersRequestId = randomUUID();
    const usersPage = await this.#http.getHubJson<HubUsersDto>(`${teamPath}/users`, {
      fields: "id,login,name,banned", $skip: query.page.skip, $top: query.page.top + 1,
    }, usersRequestId);
    const usersRaw = hubCollection(usersPage.users, "users", usersRequestId);
    const warnings = [
      "Project team data was read from the Hub compatibility API because the YouTrack project-team API is unavailable.",
    ];

    const directIds = new Set<string>();
    let directCompleteness: ProjectTeamSnapshot["completeness"]["directMembership"] = {
      status: "complete", reason: "authoritative_source_exhausted",
    };
    try {
      const chunk = 100;
      for (let skip = 0; skip < 10_000; skip += chunk) {
        const requestId = randomUUID();
        const page = await this.#http.getHubJson<HubOwnUsersDto>(`${teamPath}/ownUsers`, {
          fields: "id", $skip: skip, $top: chunk,
        }, requestId);
        const ownUsers = hubCollection(page.ownUsers, "ownUsers", requestId);
        for (const user of ownUsers) if (typeof user.id === "string") directIds.add(user.id);
        const total = validTotal(page.total);
        if ((total !== null && skip + ownUsers.length >= total) || ownUsers.length < chunk) break;
        if (skip + chunk >= 10_000) {
          directCompleteness = { status: "partial", reason: "source_truncated" };
          warnings.push("Direct membership enumeration from Hub reached its safety bound and was truncated.");
        }
      }
    } catch (error: unknown) {
      if (!partialReadError(error)) throw error;
      directCompleteness = { status: "unavailable", reason: "source_unavailable" };
      warnings.push("Direct membership is unavailable from the Hub compatibility API.");
    }

    let groupsRaw: readonly ReturnType<typeof mapHubProjectTeamGroup>[] = [];
    let groupsHasMore = false;
    let groupsCompleteness: ProjectTeamSnapshot["completeness"]["groups"] = {
      status: "complete", reason: "authoritative_source_exhausted",
    };
    try {
      const requestId = randomUUID();
      const page = await this.#http.getHubJson<HubGroupsDto>(`${teamPath}/groups`, {
        fields: "id,name,userCount,allUsers", $skip: query.page.skip, $top: query.page.top + 1,
      }, requestId);
      const raw = hubCollection(page.groups, "groups", requestId);
      groupsRaw = raw.slice(0, query.page.top).map(mapHubProjectTeamGroup);
      groupsHasMore = hubHasMore(page.total, query.page.skip, raw.length, query.page.top);
    } catch (error: unknown) {
      if (!partialReadError(error)) throw error;
      groupsCompleteness = { status: "unavailable", reason: "source_unavailable" };
      warnings.push("Direct project-team groups are unavailable from the Hub compatibility API.");
    }

    const directKnown = directCompleteness.status === "complete";
    const users: ProjectTeamMember[] = usersRaw.slice(0, query.page.top).map((raw) => {
      const user = mapHubUser(raw);
      return {
        ...user,
        membership: directKnown ? (directIds.has(user.id) ? "direct" : "via_group") : "unknown",
        roles: null,
      };
    });
    warnings.push("Project-scoped role assignments are unavailable through the Hub compatibility source; no role identity mapping is inferred.");
    warnings.push("The public project-team APIs do not expose job titles; no job title is inferred from role assignments.");

    return {
      project: query.project,
      users,
      groups: groupsRaw,
      usersPage: {
        skip: query.page.skip, requestedTop: query.page.top, returned: users.length,
        hasMore: hubHasMore(usersPage.total, query.page.skip, usersRaw.length, query.page.top),
      },
      groupsPage: {
        skip: query.page.skip, requestedTop: query.page.top, returned: groupsRaw.length, hasMore: groupsHasMore,
      },
      teamRoles: null,
      rolesAvailable: false,
      warnings,
      source: "hub_project_team",
      completeness: {
        users: { status: "complete", reason: "authoritative_source_exhausted" },
        groups: groupsCompleteness,
        directMembership: directCompleteness,
        roles: { status: "unavailable", reason: "source_unavailable" },
      },
    };
  }

  public async listIssueActivities(query: IssueActivityQuery): Promise<PageSlice<ReturnType<typeof mapIssueActivity>>> {
    const raw = await this.#http.getJson<ActivityDto[]>(`${issuePath(query.issue)}/activities`, {
      fields: ACTIVITY_FIELDS,
      categories: query.categories.join(","),
      reverse: query.reverse,
      $skip: query.page.skip,
      $top: query.page.top + 1,
      ...(query.start === undefined ? {} : { start: query.start }),
      ...(query.end === undefined ? {} : { end: query.end }),
    }, randomUUID());
    const mapped = raw.map(mapIssueActivity);
    const filtered = query.fieldNames.length === 0 ? mapped : mapped.filter((item) => {
      const fieldName = item.field?.name;
      return fieldName != null && query.fieldNames.includes(fieldName);
    });
    return { items: filtered.slice(0, query.page.top), hasMore: raw.length > query.page.top };
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
    requestId = randomUUID(),
  ): Promise<MutationWriteReceipt> {
    const raw = await this.#http.requestJson<IssueDto>({
      method: "POST",
      path: issuePath(issue),
      query: { fields: "id,idReadable" },
      requestId,
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

  public async addIssueLink(issue: IssueSelector, containerId: string, targetIssueId: string, requestId = randomUUID()): Promise<void> {
    await this.#http.requestJson({ method: "POST", path: `${issuePath(issue)}/links/${encodeURIComponent(containerId)}/issues`, requestId, body: { id: targetIssueId } });
  }

  public async removeIssueLink(issue: IssueSelector, containerId: string, targetIssueId: string, requestId = randomUUID()): Promise<void> {
    await this.#http.requestJson({ method: "DELETE", path: `${issuePath(issue)}/links/${encodeURIComponent(containerId)}/issues/${encodeURIComponent(targetIssueId)}`, requestId });
  }

  public async addIssueTag(issue: IssueSelector, tagId: string, requestId = randomUUID()): Promise<void> {
    await this.#http.requestJson({ method: "POST", path: `${issuePath(issue)}/tags`, requestId, body: { id: tagId } });
  }

  public async removeIssueTag(issue: IssueSelector, tagId: string, requestId = randomUUID()): Promise<void> {
    await this.#http.requestJson({ method: "DELETE", path: `${issuePath(issue)}/tags/${encodeURIComponent(tagId)}`, requestId });
  }

  public async createTag(command: CreateTagCommand): Promise<TagSummary> {
    const raw = await this.#http.requestJson<TagDto>({ method: "POST", path: "tags", query: { fields: TAG_FIELDS }, requestId: randomUUID(), body: { name: command.name, owner: { id: command.ownerId } } });
    return mapTag(raw, this.#baseUrl);
  }
}
