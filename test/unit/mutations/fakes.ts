import type { CreateIssueCommand, MutationWriteReceipt, UpdateIssueCommand } from "../../../src/application/ports.js";
import type { IssueSelector } from "../../../src/domain/identifiers.js";
import type { IssueSection, IssueSnapshot } from "../../../src/domain/issue.js";
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
  public updateCalls: { issue: IssueSelector; command: UpdateIssueCommand }[] = [];
  public afterIssue: IssueSnapshot | null = ISSUE_A;
  public writeError: unknown = null;
  public probeSelectors: IssueSelector[] = [];
  public issueReads = 0;
  public adminSchemaCalls = 0;

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
    return super.getIssue(issue, sections);
  }

  public override updateIssue(issue: IssueSelector, command: UpdateIssueCommand): Promise<MutationWriteReceipt> {
    this.updateCalls.push({ issue, command });
    if (this.writeError !== null) return Promise.reject(this.writeError instanceof Error ? this.writeError : new Error("synthetic write error"));
    this.issue = this.afterIssue;
    return Promise.resolve({ issueId: ISSUE_A.id, issueIdReadable: ISSUE_A.idReadable });
  }
}

export function mutationContext(gateway = new MutationFakeGateway()) {
  return createReadContext(gateway);
}
