import { DomainValidationError, getSelectorEntry, type IssueSelector, type TagSelector, type UserSelector } from "../../domain/identifiers.js";
import { createOperationResult, type OperationResult } from "../../domain/operation-result.js";
import type { MutationContext } from "../ports.js";
import { runIssueMutation, type MutationGuards } from "../mutation-runner.js";
import { readIssueExact } from "./support.js";

interface TagMutationInput extends MutationGuards { readonly issue: IssueSelector; readonly tag: TagSelector }

async function resolveTag(context: MutationContext, selector: TagSelector) {
  const key = getSelectorEntry(selector, ["id", "exactName"]);
  const slice = await context.gateway.listTags({ page: { skip: 0, top: 100 }, ...(key.key === "exactName" ? { query: key.value } : {}) });
  const matches = slice.items.filter((tag) => key.key === "id" ? tag.id === key.value : tag.name === key.value);
  if (slice.hasMore && matches.length < 1) throw new DomainValidationError("tags_incomplete");
  if (matches.length !== 1) throw new DomainValidationError(matches.length === 0 ? "tag_not_found" : "tag_ambiguous");
  const match = matches[0];
  if (match === undefined) throw new DomainValidationError("tag_not_found");
  return match;
}

export async function addTag(context: MutationContext, input: TagMutationInput): Promise<OperationResult<unknown>> {
  const requestId = context.ids.nextId(), before = await readIssueExact(context, input.issue), tag = await resolveTag(context, input.tag);
  const snapshot = await context.gateway.getIssue({ id: before.id }, ["system", "tags"]);
  if (snapshot === null) throw new DomainValidationError("issue_not_found");
  if (snapshot.tags.some((item) => item.id === tag.id)) return createOperationResult({ status: "existing", operation: "youtrack_add_tag", requestId, target: { kind: "tag", id: tag.id, name: tag.name }, before: snapshot });
  return runIssueMutation({ operation: "youtrack_add_tag", requestId, before: snapshot, guards: input, plan: { target: before.idReadable, changes: [`addTag:${tag.id}`], writeCount: 1 }, write: () => context.gateway.addIssueTag({ id: before.id }, tag.id), reread: () => context.gateway.getIssue({ id: before.id }, ["system", "tags"]), verify: (after) => ({ verified: after.tags.some((item) => item.id === tag.id), mismatches: [] }) });
}

export async function removeTag(context: MutationContext, input: TagMutationInput): Promise<OperationResult<unknown>> {
  const requestId = context.ids.nextId(), before = await readIssueExact(context, input.issue), tag = await resolveTag(context, input.tag);
  const snapshot = await context.gateway.getIssue({ id: before.id }, ["system", "tags"]);
  if (snapshot === null) throw new DomainValidationError("issue_not_found");
  if (!snapshot.tags.some((item) => item.id === tag.id)) return createOperationResult({ status: "not_found", operation: "youtrack_remove_tag", requestId, target: { kind: "tag", id: tag.id, name: tag.name }, before: snapshot });
  return runIssueMutation({ operation: "youtrack_remove_tag", requestId, before: snapshot, guards: input, plan: { target: before.idReadable, changes: [`removeTag:${tag.id}`], writeCount: 1 }, write: () => context.gateway.removeIssueTag({ id: before.id }, tag.id), reread: () => context.gateway.getIssue({ id: before.id }, ["system", "tags"]), verify: (after) => ({ verified: !after.tags.some((item) => item.id === tag.id), mismatches: [] }) });
}

export async function createTag(context: MutationContext, input: { readonly name: string; readonly owner: UserSelector; readonly dryRun?: boolean | undefined; readonly visibleFor?: readonly unknown[] | undefined; readonly updateableBy?: readonly unknown[] | undefined }): Promise<OperationResult<unknown>> {
  const requestId = context.ids.nextId();
  if (input.visibleFor !== undefined || input.updateableBy !== undefined) throw new DomainValidationError("unsupported_sharing_contract");
  const existing = await context.gateway.listTags({ page: { skip: 0, top: 100 }, query: input.name });
  const exact = existing.items.filter((tag) => tag.name === input.name);
  if (exact.length > 1) throw new DomainValidationError("tag_ambiguous");
  const existingTag = exact[0];
  if (existingTag !== undefined) return createOperationResult({ status: "existing", operation: "youtrack_create_tag", requestId, target: { kind: "tag", id: existingTag.id, name: existingTag.name } });
  if (existing.hasMore) throw new DomainValidationError("tags_incomplete");
  const users = await context.gateway.findUsers({ selector: input.owner, page: { skip: 0, top: 100 }, includeBanned: false });
  const key = getSelectorEntry(input.owner, ["id", "login", "email"]), matches = users.items.filter((user) => user[key.key] === key.value);
  if (matches.length !== 1) throw new DomainValidationError(matches.length === 0 ? "user_not_found" : "user_ambiguous");
  const owner = matches[0];
  if (owner === undefined) throw new DomainValidationError("user_not_found");
  if (input.dryRun === true) return createOperationResult({ status: "ok", operation: "youtrack_create_tag", requestId, data: { plan: { name: input.name, ownerId: owner.id, writeCount: 1 } }, journal: [{ name: "create_tag", status: "planned" }] });
  const tag = await context.gateway.createTag({ name: input.name, ownerId: owner.id });
  const check = await context.gateway.listTags({ page: { skip: 0, top: 100 }, query: input.name });
  const verified = check.items.some((item) => item.id === tag.id && item.name === input.name);
  return createOperationResult({ status: verified ? "created" : "failed", operation: "youtrack_create_tag", requestId, target: { kind: "tag", id: tag.id, name: tag.name }, after: tag, verified, journal: [{ name: "create_tag", status: "completed", verified }], ...(verified ? {} : { error: { kind: "postcondition_mismatch", message: "Created tag was not proven by reconciliation read", httpStatus: null, retryable: false, details: {} } }) });
}
