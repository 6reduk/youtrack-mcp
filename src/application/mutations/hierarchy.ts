import { DomainValidationError, type IssueSelector, type LinkDirection, type LinkTypeSelector } from "../../domain/identifiers.js";
import { createOperationResult, type OperationResult } from "../../domain/operation-result.js";
import type { MutationContext } from "../ports.js";
import type { MutationGuards } from "../mutation-runner.js";
import { readIssueExact } from "./support.js";
import { addLink, removeLink } from "./links.js";

interface ParentBase extends MutationGuards {
  readonly child: IssueSelector;
  readonly linkType: LinkTypeSelector;
  readonly parentToChildDirection: LinkDirection;
}
export interface SetParentInput extends ParentBase { readonly parent: IssueSelector; readonly preventCycle?: boolean | undefined; readonly replaceExisting?: boolean | undefined; readonly expectedCurrentParent?: IssueSelector | undefined }
export interface RemoveParentInput extends ParentBase { readonly expectedParent: IssueSelector }
const inverse = (direction: LinkDirection): LinkDirection => direction === "source_to_target" ? "target_to_source" : "source_to_target";

async function currentParents(context: MutationContext, input: ParentBase) {
  const child = await readIssueExact(context, input.child);
  const slice = await context.gateway.listRelatedIssues({ issue: { id: child.id }, linkType: input.linkType, direction: inverse(input.parentToChildDirection), page: { skip: 0, top: 100 } });
  if (slice.hasMore) throw new DomainValidationError("parent_relation_incomplete");
  return { child, parents: slice.items };
}

export async function setParent(context: MutationContext, input: SetParentInput): Promise<OperationResult<unknown>> {
  const state = await currentParents(context, input), parent = await readIssueExact(context, input.parent);
  if (state.child.id === parent.id) throw new DomainValidationError("self_parent_invalid");
  if (state.parents.some((item) => item.id === parent.id)) return createOperationResult({ status: "existing", operation: "youtrack_set_parent", requestId: context.ids.nextId(), target: { kind: "link", id: parent.id }, before: state.child });
  if (state.parents.length === 0) return addLink(context, { source: { id: parent.id }, target: { id: state.child.id }, linkType: input.linkType, direction: input.parentToChildDirection, preventCycle: input.preventCycle ?? true, dryRun: input.dryRun, ...(input.expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: input.expectedUpdatedAt }) }, "youtrack_set_parent");
  if (input.replaceExisting !== true || input.expectedCurrentParent === undefined) return createOperationResult({ status: "conflict", operation: "youtrack_set_parent", requestId: context.ids.nextId(), target: { kind: "issue", id: state.child.id, idReadable: state.child.idReadable }, before: state.child, error: { kind: "existing_parent_conflict", message: "A different parent exists; replacement requires replaceExisting and expectedCurrentParent", httpStatus: null, retryable: false, details: { parentCount: state.parents.length } } });
  const expected = await readIssueExact(context, input.expectedCurrentParent);
  const observedParent = state.parents[0];
  if (state.parents.length !== 1 || observedParent?.id !== expected.id) return createOperationResult({ status: "conflict", operation: "youtrack_set_parent", requestId: context.ids.nextId(), target: { kind: "issue", id: state.child.id }, error: { kind: "expected_parent_mismatch", message: "Observed parent differs from expectedCurrentParent", httpStatus: null, retryable: false, details: {} } });
  if (input.dryRun === true) return createOperationResult({ status: "ok", operation: "youtrack_set_parent", requestId: context.ids.nextId(), data: { plan: { writeCount: 2, remove: expected.id, add: parent.id } }, journal: [{ name: "remove_parent", status: "planned" }, { name: "add_parent", status: "planned" }] });
  const removed = await removeLink(context, { source: { id: expected.id }, target: { id: state.child.id }, linkType: input.linkType, direction: input.parentToChildDirection });
  if (removed.status !== "updated") return createOperationResult({ ...removed, operation: "youtrack_set_parent", status: "failed", requestId: context.ids.nextId(), journal: [{ name: "remove_parent", status: "failed", verified: removed.verified }, { name: "add_parent", status: "skipped" }] });
  const added = await addLink(context, { source: { id: parent.id }, target: { id: state.child.id }, linkType: input.linkType, direction: input.parentToChildDirection, preventCycle: input.preventCycle ?? true });
  if (added.status !== "updated") return createOperationResult({ status: "failed", operation: "youtrack_set_parent", requestId: context.ids.nextId(), target: { kind: "issue", id: state.child.id }, before: state.child, after: added.after, verified: false, warnings: [{ kind: "partial_mutation", message: "Old parent was removed but new parent was not proven added" }], journal: [{ name: "remove_parent", status: "completed", verified: true }, { name: "add_parent", status: "failed", verified: added.verified }], error: { kind: "partial_mutation", message: "Parent replacement completed only its removal step", httpStatus: null, retryable: false, details: {} } });
  return createOperationResult({ status: "updated", operation: "youtrack_set_parent", requestId: context.ids.nextId(), target: { kind: "issue", id: state.child.id }, before: state.child, after: added.after, verified: true, journal: [{ name: "remove_parent", status: "completed", verified: true }, { name: "add_parent", status: "completed", verified: true }] });
}

export async function removeParent(context: MutationContext, input: RemoveParentInput): Promise<OperationResult<unknown>> {
  const state = await currentParents(context, input), expected = await readIssueExact(context, input.expectedParent);
  if (!state.parents.some((item) => item.id === expected.id)) return createOperationResult({ status: state.parents.length === 0 ? "not_found" : "conflict", operation: "youtrack_remove_parent", requestId: context.ids.nextId(), target: { kind: "issue", id: state.child.id }, before: state.child });
  return removeLink(context, { source: { id: expected.id }, target: { id: state.child.id }, linkType: input.linkType, direction: input.parentToChildDirection, dryRun: input.dryRun, ...(input.expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: input.expectedUpdatedAt }) }, "youtrack_remove_parent");
}
