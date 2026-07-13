import assert from "node:assert/strict";
import test from "node:test";
import { addLink } from "../../../src/application/mutations/links.js";
import { addTag, createTag, removeTag } from "../../../src/application/mutations/tags.js";
import { getSelectorEntry, type IssueSelector } from "../../../src/domain/identifiers.js";
import type { IssueSection, IssueSnapshot, TagSummary } from "../../../src/domain/issue.js";
import { MutationFakeGateway, mutationContext } from "./fakes.js";
import { ISSUE_A, LINK_TYPE_A, TAG_A, USER_A } from "../reads/fakes.js";

class Stage7Gateway extends MutationFakeGateway {
  writes: string[] = [];
  override getIssue(issue: IssueSelector, sections: readonly IssueSection[]): Promise<IssueSnapshot | null> { void sections; const id = getSelectorEntry(issue, ["id", "idReadable"]).value; return Promise.resolve(id === "issue-b" ? { ...ISSUE_A, id: "issue-b", idReadable: "ALPHA-2", summary: "B" } : this.issue); }
  override addIssueLink(issue: IssueSelector, container: string, target: string): Promise<void> { void issue; this.writes.push(`add-link:${container}:${target}`); this.issue = { ...ISSUE_A, links: [{ id: container, type: LINK_TYPE_A, direction: "source_to_target", source: { id: ISSUE_A.id, idReadable: ISSUE_A.idReadable, summary: ISSUE_A.summary, url: ISSUE_A.url }, target: { id: "issue-b", idReadable: "ALPHA-2", summary: "B", url: "https://tracker.example.test/issue/ALPHA-2" } }] }; return Promise.resolve(); }
  override addIssueTag(issue: IssueSelector, tagId: string): Promise<void> { void issue; this.writes.push(`add-tag:${tagId}`); this.issue = { ...ISSUE_A, tags: [TAG_A] }; return Promise.resolve(); }
  override removeIssueTag(issue: IssueSelector, tagId: string): Promise<void> { void issue; this.writes.push(`remove-tag:${tagId}`); this.issue = { ...ISSUE_A, tags: [] }; return Promise.resolve(); }
  override createTag(command: { name: string; ownerId: string }): Promise<TagSummary> { this.writes.push(`create-tag:${command.name}:${command.ownerId}`); return Promise.resolve({ ...TAG_A, name: command.name }); }
}

void test("link dry-run resolves exact type/container and performs zero writes", async () => {
  const gateway = new Stage7Gateway();
  const result = await addLink(mutationContext(gateway), { source: { id: ISSUE_A.id }, target: { id: "issue-b" }, linkType: { id: LINK_TYPE_A.id }, direction: "source_to_target", dryRun: true });
  assert.equal(result.status, "ok"); assert.deepEqual(gateway.writes, []);
});

void test("tag add/remove use separate exact operations and verify", async () => {
  const gateway = new Stage7Gateway();
  gateway.issue = ISSUE_A; gateway.tags = { items: [TAG_A], hasMore: false };
  const added = await addTag(mutationContext(gateway), { issue: { id: ISSUE_A.id }, tag: { id: TAG_A.id } });
  assert.equal(added.status, "updated");
  const removed = await removeTag(mutationContext(gateway), { issue: { id: ISSUE_A.id }, tag: { id: TAG_A.id } });
  assert.equal(removed.status, "updated");
  assert.deepEqual(gateway.writes, [`add-tag:${TAG_A.id}`, `remove-tag:${TAG_A.id}`]);
});

void test("create tag is explicit and sharing stays disabled until its codec is verified", async () => {
  const gateway = new Stage7Gateway(); gateway.tags = { items: [], hasMore: false }; gateway.users = { items: [USER_A], hasMore: false };
  const dry = await createTag(mutationContext(gateway), { name: "New exact tag", owner: { id: USER_A.id }, dryRun: true });
  assert.equal(dry.status, "ok"); assert.deepEqual(gateway.writes, []);
  await assert.rejects(() => createTag(mutationContext(gateway), { name: "New exact tag", owner: { id: USER_A.id }, visibleFor: [{ id: "group" }] }), /unsupported_sharing_contract/);
});
