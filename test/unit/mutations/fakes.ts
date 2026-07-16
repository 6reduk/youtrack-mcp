import type { CreateIssueCommand, LinkContainerReference, MutationWriteReceipt, PageSlice, RelatedIssuesQuery, UpdateIssueCommand } from "../../../src/application/ports.js";
import { getSelectorEntry, type IssueSelector, type PageRequest } from "../../../src/domain/identifiers.js";
import type { IssueSection, IssueSnapshot, TagSummary } from "../../../src/domain/issue.js";
import type { IssueReference, LinkSnapshot } from "../../../src/domain/links.js";
import type { ProjectSummary } from "../../../src/domain/project-schema.js";
import type { SchemaFragment } from "../../../src/application/ports.js";
import type { FieldDefinition } from "../../../src/domain/project-schema.js";
import { FakeGateway, ISSUE_A, PROJECT_A, USER_A, createReadContext } from "../reads/fakes.js";

export const ENUM_FIELD: FieldDefinition = {
  id: "field-phase-id",
  name: "Arbitrary phase",
  fieldType: "enum[1]",
  valueType: "enum",
  valueShape: "entity",
  cardinality: "single",
  required: false,
  writability: "unknown",
  valuesComplete: true,
  allowedValues: [{ id: "choice-next-id", name: "Choice Next", kind: "EnumBundleElement" }],
  provenance: ["admin_project_fields"],
};

export const USER_FIELD: FieldDefinition = {
  ...ENUM_FIELD,
  id: "field-user-id",
  name: "Arbitrary person",
  fieldType: "user[1]",
  valueType: "user",
  valueShape: "user",
  allowedValues: [{ id: USER_A.id, name: USER_A.name ?? USER_A.login, kind: "User" }],
};

export function issueWith(
  values: Partial<Pick<IssueSnapshot, "summary" | "description" | "updatedAt" | "customFields">>,
): IssueSnapshot {
  return { ...ISSUE_A, ...values };
}

export class MutationFakeGateway extends FakeGateway {
  public createCalls: CreateIssueCommand[] = [];
  public updateCalls: { issue: IssueSelector; command: UpdateIssueCommand; requestId?: string }[] = [];
  public afterIssue: IssueSnapshot | null = ISSUE_A;
  public writeError: unknown = null;
  public probeSelectors: IssueSelector[] = [];
  public issueReads = 0;
  public adminSchemaCalls = 0;
  /** Ordered gateway evidence used by execute-plan safety tests. */
  public events: string[] = [];
  public issuesById = new Map<string, IssueSnapshot | null>();
  public issueReadQueues = new Map<string, (IssueSnapshot | null | Error)[]>();
  public issueTagsById = new Map<string, readonly TagSummary[]>();
  public issueLinksById = new Map<string, readonly LinkSnapshot[]>();
  public addTagCalls: { issue: IssueSelector; tagId: string; requestId?: string }[] = [];
  public removeTagCalls: { issue: IssueSelector; tagId: string; requestId?: string }[] = [];
  public addLinkCalls: { issue: IssueSelector; containerId: string; targetIssueId: string; requestId?: string }[] = [];
  public removeLinkCalls: { issue: IssueSelector; containerId: string; targetIssueId: string; requestId?: string }[] = [];
  public linkContainers: readonly LinkContainerReference[] = [{ id: "container-a", linkTypeId: "link-type-a-id", direction: "source_to_target" }];
  public relatedIssueSlices: PageSlice<IssueReference>[] = [];
  public writeErrors: unknown[] = [];
  public mutateOnWrite: ((kind: string, issueId: string) => void) | null = null;

  public constructor() {
    super();
    this.adminSchema = {
      source: { kind: "admin_project_fields", outcome: "ok" },
      schemaComplete: true,
      fields: [ENUM_FIELD, USER_FIELD],
    };
    this.issue = ISSUE_A;
    this.users = { items: [USER_A], hasMore: false };
    this.projects = [PROJECT_A];
  }

  public override createIssue(command: CreateIssueCommand): Promise<MutationWriteReceipt> {
    this.createCalls.push(command);
    if (this.writeError !== null) return Promise.reject(this.writeError instanceof Error ? this.writeError : new Error("synthetic write error"));
    this.issue = this.afterIssue;
    return Promise.resolve({ issueId: ISSUE_A.id, issueIdReadable: ISSUE_A.idReadable });
  }

  public override getProbeProjectSchema(issue: IssueSelector) {
    this.probeSelectors.push(issue);
    return super.getProbeProjectSchema(issue);
  }

  public override getAdminProjectSchema(project: ProjectSummary): Promise<SchemaFragment> {
    this.adminSchemaCalls += 1;
    return super.getAdminProjectSchema(project);
  }

  public override getIssue(issue: IssueSelector, sections: readonly IssueSection[]): Promise<IssueSnapshot | null> {
    this.issueReads += 1;
    const key = getSelectorEntry(issue, ["id", "idReadable"]).value;
    this.events.push(`read:${key}:${sections.join(",")}`);
    const queue = this.issueReadQueues.get(key);
    const queued = queue?.shift();
    if (queued instanceof Error) return Promise.reject(queued);
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.issuesById.has(key)) return Promise.resolve(this.issuesById.get(key) ?? null);
    for (const value of this.issuesById.values()) {
      if (value?.idReadable === key) return Promise.resolve(value);
    }
    return super.getIssue(issue, sections);
  }

  public override updateIssue(issue: IssueSelector, command: UpdateIssueCommand, requestId?: string): Promise<MutationWriteReceipt> {
    this.updateCalls.push({ issue, command, ...(requestId === undefined ? {} : { requestId }) });
    const id = getSelectorEntry(issue, ["id", "idReadable"]).value;
    this.events.push(`write:update:${id}`);
    const queuedError = this.writeErrors.shift();
    if (queuedError !== undefined) return Promise.reject(queuedError instanceof Error ? queuedError : new Error("synthetic write error"));
    if (this.writeError !== null) return Promise.reject(this.writeError instanceof Error ? this.writeError : new Error("synthetic write error"));
    this.mutateOnWrite?.("update", id);
    if (this.issuesById.has(id) && this.afterIssue !== null) this.issuesById.set(id, this.afterIssue);
    this.issue = this.afterIssue;
    return Promise.resolve({ issueId: ISSUE_A.id, issueIdReadable: ISSUE_A.idReadable });
  }

  public override listIssueTags(issue: IssueSelector, page: PageRequest) {
    void page;
    const id = getSelectorEntry(issue, ["id", "idReadable"]).value;
    this.events.push(`read-tags:${id}`);
    return Promise.resolve({ items: this.issueTagsById.get(id) ?? this.tags.items, hasMore: this.tags.hasMore });
  }

  public override listIssueLinks(issue: IssueSelector, page: PageRequest) {
    void page;
    const id = getSelectorEntry(issue, ["id", "idReadable"]).value;
    this.events.push(`read-links:${id}`);
    return Promise.resolve({ items: this.issueLinksById.get(id) ?? this.links.items, hasMore: this.links.hasMore });
  }

  private nextWriteError(): unknown {
    return this.writeErrors.shift() ?? this.writeError;
  }

  public override addIssueTag(issue: IssueSelector, tagId: string, requestId?: string): Promise<void> {
    const id = getSelectorEntry(issue, ["id", "idReadable"]).value;
    this.addTagCalls.push({ issue, tagId, ...(requestId === undefined ? {} : { requestId }) }); this.events.push(`write:add-tag:${id}:${tagId}`);
    const error = this.nextWriteError();
    this.mutateOnWrite?.("add_tag", id);
    return error === null ? Promise.resolve() : Promise.reject(error instanceof Error ? error : new Error("synthetic write error"));
  }

  public override removeIssueTag(issue: IssueSelector, tagId: string, requestId?: string): Promise<void> {
    const id = getSelectorEntry(issue, ["id", "idReadable"]).value;
    this.removeTagCalls.push({ issue, tagId, ...(requestId === undefined ? {} : { requestId }) }); this.events.push(`write:remove-tag:${id}:${tagId}`);
    const error = this.nextWriteError();
    this.mutateOnWrite?.("remove_tag", id);
    return error === null ? Promise.resolve() : Promise.reject(error instanceof Error ? error : new Error("synthetic write error"));
  }

  public override addIssueLink(issue: IssueSelector, containerId: string, targetIssueId: string, requestId?: string): Promise<void> {
    const id = getSelectorEntry(issue, ["id", "idReadable"]).value;
    this.addLinkCalls.push({ issue, containerId, targetIssueId, ...(requestId === undefined ? {} : { requestId }) }); this.events.push(`write:add-link:${id}:${targetIssueId}`);
    const error = this.nextWriteError();
    this.mutateOnWrite?.("add_link", id);
    return error === null ? Promise.resolve() : Promise.reject(error instanceof Error ? error : new Error("synthetic write error"));
  }

  public override removeIssueLink(issue: IssueSelector, containerId: string, targetIssueId: string, requestId?: string): Promise<void> {
    const id = getSelectorEntry(issue, ["id", "idReadable"]).value;
    this.removeLinkCalls.push({ issue, containerId, targetIssueId, ...(requestId === undefined ? {} : { requestId }) }); this.events.push(`write:remove-link:${id}:${targetIssueId}`);
    const error = this.nextWriteError();
    this.mutateOnWrite?.("remove_link", id);
    return error === null ? Promise.resolve() : Promise.reject(error instanceof Error ? error : new Error("synthetic write error"));
  }

  public override listLinkContainers(issue: IssueSelector): Promise<readonly LinkContainerReference[]> {
    const id = getSelectorEntry(issue, ["id", "idReadable"]).value;
    this.events.push(`read-containers:${id}`);
    return Promise.resolve(this.linkContainers);
  }

  public override listRelatedIssues(query: RelatedIssuesQuery) {
    this.events.push(`read-related:${getSelectorEntry(query.issue, ["id", "idReadable"]).value}:${query.direction}`);
    return Promise.resolve(this.relatedIssueSlices.shift() ?? this.relatedIssues);
  }
}

export function mutationContext(gateway = new MutationFakeGateway()) {
  return createReadContext(gateway);
}
