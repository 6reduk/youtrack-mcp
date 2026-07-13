import type { IssueSelector, LinkDirection } from "./identifiers.js";

export interface LinkTypeDefinition {
  readonly id: string;
  readonly name: string;
  readonly directed: boolean;
  readonly aggregation: boolean;
  readonly sourceToTargetName: string;
  readonly targetToSourceName: string | null;
  readonly localizedNames: readonly string[];
}

export interface IssueReference {
  readonly id: string;
  readonly idReadable: string;
  readonly summary: string;
  readonly url: string;
}

export interface LinkSnapshot {
  readonly id: string | null;
  readonly type: LinkTypeDefinition;
  readonly direction: LinkDirection;
  readonly source: IssueReference;
  readonly target: IssueReference;
}

export interface DeclaredRelation {
  readonly source: IssueSelector;
  readonly target: IssueSelector;
  readonly linkTypeId: string;
  readonly direction: LinkDirection;
}
