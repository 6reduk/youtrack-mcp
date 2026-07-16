# Testing

`npm run verify` runs type checking, linting, unit/contract/protocol tests, build, secret/installation scans, and tarball allowlist validation.

The automated suite covers `youtrack_execute_plan` at domain, planner, HTTP contract, and MCP protocol levels. It pins canonical JSON/hash behavior, strict preview/confirmation schemas, the 1–20 operation bound, all eight operation variants, exact resolution, duplicate-subject rejection, whole-plan zero-write preflight, hash mismatch, sequential execution, timestamp races, desired-state replay, read-after-write proof, uncertain-response reconciliation, stop-on-error, skipped steps, and partial-completion reporting.

Read-only live checks require `YOUTRACK_LIVE_READ_TESTS=1`. Mutation tests additionally require an exact sandbox project, unique `mcp-live-*` prefix, and a matching approval value. Current mutation test files intentionally stop before any network mutation, including batch execution.

The connection and agile-board discovery live checks need only `YOUTRACK_LIVE_READ_TESTS=1`. Scoped agile audit checks additionally require `YOUTRACK_LIVE_PROJECT` (project short name), `YOUTRACK_LIVE_BOARD_ID`, and `YOUTRACK_LIVE_ISSUE` (readable issue ID). They perform GET requests only and safely skip when this live configuration is absent.

Generate a secret-free plan with:

```bash
YOUTRACK_LIVE_MUTATION_PROJECT=SANDBOX \
YOUTRACK_LIVE_MUTATION_PREFIX=mcp-live-unique-run \
npm run live:mutation:manifest
```

No automated cleanup exists; approved live artifacts must be archived and cleaned manually.

Generating the manifest does not authorize a write. Before enabling `YOUTRACK_LIVE_MUTATION_TESTS=1`, a human must separately approve the exact resolved issue IDs, fields/values, tag IDs, link type/direction, ordered calls, and expected cleanup. Set `YOUTRACK_LIVE_MUTATION_APPROVAL` to the exact `project:prefix` value only after that review. For `youtrack_execute_plan`, approval must also cover the read-only preview output and its exact `planHash`; never reuse approval after a changed preview.
