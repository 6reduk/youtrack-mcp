import type { ReadableFieldValue } from "./field-values.js";
import type { LinkSnapshot } from "./links.js";
import type { ProjectSummary } from "./project-schema.js";

export interface UserSummary {
  readonly id: string;
  readonly login: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly banned: boolean | null;
}

export interface TagSummary {
  readonly id: string;
  readonly name: string;
  readonly url: string | null;
  readonly owner: UserSummary | null;
}

export interface IssueCustomFieldSnapshot {
  readonly id: string;
  readonly name: string;
  readonly fieldType: string;
  readonly valueType: string | null;
  readonly value: ReadableFieldValue | null;
  readonly rawType: string | null;
}

export interface IssueSnapshot {
  readonly id: string;
  readonly idReadable: string;
  readonly url: string;
  readonly summary: string;
  readonly description: string | null;
  readonly project: ProjectSummary;
  readonly reporter: UserSummary | null;
  readonly creator: UserSummary | null;
  readonly updater: UserSummary | null;
  readonly createdAt: number | null;
  readonly updatedAt: number | null;
  readonly resolvedAt: number | null;
  readonly customFields: readonly IssueCustomFieldSnapshot[];
  readonly tags: readonly TagSummary[];
  readonly links: readonly LinkSnapshot[];
}

export type IssueSection =
  | "system"
  | "description"
  | "customFields"
  | "tags"
  | "links"
  | "users";
