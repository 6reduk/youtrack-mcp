const project = process.env.YOUTRACK_LIVE_MUTATION_PROJECT?.trim();
const prefix = process.env.YOUTRACK_LIVE_MUTATION_PREFIX?.trim();
if (!project || !prefix || !/^mcp-live-[a-z0-9-]{8,64}$/.test(prefix)) {
  process.stderr.write("Set exact YOUTRACK_LIVE_MUTATION_PROJECT and unique YOUTRACK_LIVE_MUTATION_PREFIX=mcp-live-*\n");
  process.exit(2);
}
const manifest = {
  mode: "PLAN_ONLY_NO_NETWORK",
  project,
  runPrefix: prefix,
  cleanup: "manual; no delete or bulk cleanup is implemented",
  calls: [
    { order: 1, tool: "youtrack_create_issue", summary: `${prefix}-source`, dryRun: false },
    { order: 2, tool: "youtrack_create_issue", summary: `${prefix}-target`, dryRun: false },
    { order: 3, tool: "youtrack_update_issue", target: "result(order=1)", guard: "expectedUpdatedAt from reconciliation read" },
    { order: 4, tool: "youtrack_add_link", source: "result(order=1)", target: "result(order=2)", linkType: "must be supplied after read-only discovery", direction: "must be supplied explicitly" },
    { order: 5, tool: "youtrack_add_tag", target: "result(order=1)", tag: "must be supplied after exact read-only discovery" },
  ],
  blockedUntil: "separate approval of resolved issue IDs, link type/direction, tag ID, and exact ordered calls",
};
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
