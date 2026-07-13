import { wouldCreateCycle } from "../../domain/cycle-check.js";
import { DomainValidationError, getSelectorEntry, type IssueSelector, type LinkDirection, type LinkTypeSelector } from "../../domain/identifiers.js";
import { createOperationResult, type OperationResult } from "../../domain/operation-result.js";
import type { IssueSnapshot } from "../../domain/issue.js";
import type { MutationContext } from "../ports.js";
import { runIssueMutation, type MutationGuards } from "../mutation-runner.js";
import { readIssueExact } from "./support.js";

export interface LinkMutationInput extends MutationGuards {
  readonly source: IssueSelector;
  readonly target: IssueSelector;
  readonly linkType: LinkTypeSelector;
  readonly direction: LinkDirection;
  readonly preventCycle?: boolean | undefined;
}

async function resolveType(context: MutationContext, selector: LinkTypeSelector) {
  const slice = await context.gateway.listLinkTypes({ skip: 0, top: 100 });
  const key = getSelectorEntry(selector, ["id", "exactName"]);
  const matches = slice.items.filter((item) => key.key === "id" ? item.id === key.value : item.name === key.value);
  if (slice.hasMore && matches.length < 1) throw new DomainValidationError("link_types_incomplete");
  if (matches.length !== 1) throw new DomainValidationError(matches.length === 0 ? "link_type_not_found" : "link_type_ambiguous");
  const match = matches[0];
  if (match === undefined) throw new DomainValidationError("link_type_not_found");
  return match;
}

function hasRelation(issue: IssueSnapshot, targetId: string, typeId: string, direction: LinkDirection): boolean {
  return issue.links.some((link) => link.type.id === typeId && link.direction === direction &&
    (direction === "source_to_target" ? link.target.id : link.source.id) === targetId);
}

async function containerId(context: MutationContext, source: IssueSnapshot, typeId: string, direction: LinkDirection): Promise<string> {
  const matches = (await context.gateway.listLinkContainers({ id: source.id }))
    .filter((item) => item.linkTypeId === typeId && item.direction === direction);
  if (matches.length !== 1) throw new DomainValidationError(matches.length === 0 ? "link_container_not_found" : "link_container_ambiguous");
  const match = matches[0];
  if (match === undefined) throw new DomainValidationError("link_container_not_found");
  return match.id;
}

async function outgoing(context: MutationContext, node: string, typeId: string, direction: LinkDirection): Promise<readonly string[]> {
  const slice = await context.gateway.listRelatedIssues({ issue: { id: node }, linkType: { id: typeId }, direction, page: { skip: 0, top: 100 } });
  if (slice.hasMore) throw new DomainValidationError("cycle_check_incomplete");
  return slice.items.map((item) => item.id);
}

export async function addLink(context: MutationContext, input: LinkMutationInput, operation = "youtrack_add_link"): Promise<OperationResult<unknown>> {
  const requestId = context.ids.nextId();
  const source = await readIssueExact(context, input.source);
  const target = await readIssueExact(context, input.target);
  if (source.id === target.id) throw new DomainValidationError("self_link_invalid");
  const type = await resolveType(context, input.linkType);
  const before = await context.gateway.getIssue({ id: source.id }, ["system", "links"]);
  if (before === null) throw new DomainValidationError("issue_not_found");
  if (hasRelation(before, target.id, type.id, input.direction)) return createOperationResult({ status: "existing", operation, requestId, target: { kind: "link", id: type.id }, before });
  if (input.preventCycle === true) {
    const result = await wouldCreateCycle(source.id, target.id, (node) => outgoing(context, node, type.id, input.direction));
    if (result.status !== "not_reachable") throw new DomainValidationError(result.status === "reachable" ? "cycle_detected" : "cycle_check_indeterminate");
  }
  const container = await containerId(context, source, type.id, input.direction);
  return runIssueMutation({ operation, requestId, before, guards: input,
    plan: { target: source.idReadable, changes: [`addLink:${type.id}:${input.direction}:${target.id}`], writeCount: 1 },
    write: () => context.gateway.addIssueLink({ id: source.id }, container, target.id),
    reread: () => context.gateway.getIssue({ id: source.id }, ["system", "links"]),
    verify: (after) => ({ verified: hasRelation(after, target.id, type.id, input.direction), mismatches: [] }),
  });
}

export async function removeLink(context: MutationContext, input: LinkMutationInput, operation = "youtrack_remove_link"): Promise<OperationResult<unknown>> {
  const requestId = context.ids.nextId();
  const source = await readIssueExact(context, input.source);
  const target = await readIssueExact(context, input.target);
  const type = await resolveType(context, input.linkType);
  const before = await context.gateway.getIssue({ id: source.id }, ["system", "links"]);
  if (before === null) throw new DomainValidationError("issue_not_found");
  if (!hasRelation(before, target.id, type.id, input.direction)) return createOperationResult({ status: "not_found", operation, requestId, target: { kind: "link", id: type.id }, before });
  const container = await containerId(context, source, type.id, input.direction);
  return runIssueMutation({ operation, requestId, before, guards: input,
    plan: { target: source.idReadable, changes: [`removeLink:${type.id}:${input.direction}:${target.id}`], writeCount: 1 },
    write: () => context.gateway.removeIssueLink({ id: source.id }, container, target.id),
    reread: () => context.gateway.getIssue({ id: source.id }, ["system", "links"]),
    verify: (after) => ({ verified: !hasRelation(after, target.id, type.id, input.direction), mismatches: [] }),
  });
}
