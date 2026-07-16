# YouTrack MCP

Universal, schema-driven MCP server for YouTrack. It exposes neutral read and mutation tools without embedding a project workflow, parent task, custom-field name, link meaning, or company-specific identifier.

Read-only discovery includes agile board configuration and sprints, project-team membership, and observed issue activity history. These tools return only facts exposed by the public YouTrack REST API and never infer roles or permitted workflow transitions.

## Requirements

- Node.js 22 or 24
- A YouTrack permanent token with only the permissions required for intended operations
- `YOUTRACK_URL` and `YOUTRACK_TOKEN` in the MCP host environment

## Run

```bash
npx -y @6reduk/youtrack-mcp@0.1.7
```

The process uses stdio for MCP and writes diagnostics only to stderr. It accepts no CLI arguments.

```text
YOUTRACK_URL=https://youtrack.example.com/
YOUTRACK_TOKEN=<set outside committed configuration>
```

Optional variables: `YOUTRACK_REQUEST_TIMEOUT_MS`, `YOUTRACK_LOG_LEVEL`, and `YOUTRACK_ALLOW_INSECURE_HTTP` (loopback testing only).

Client examples: [Codex](examples/codex.example.toml), [Claude Code](examples/claude.example.json), and [Kimi CLI](examples/kimi.example.json).

## Safety model

- Every project, issue, field, user, tag, and link type is selected explicitly.
- Field codecs are derived from observed YouTrack schema, never field names.
- Writes are not retried. Uncertain writes are reconciled with reads.
- Mutations support dry-run and issue mutations support `expectedUpdatedAt` guards.
- Link direction and hierarchy semantics always come from the caller.
- `youtrack_execute_plan` supports bounded, confirmed batches of up to 20 desired-state mutations. It is sequential and non-transactional, stops on the first unverified result, and never guesses a rollback.
- There is no batch issue/tag creation, hierarchy replacement, delete-issue, arbitrary command execution, or inferred workflow.

## Bounded mutation plans

`youtrack_execute_plan` uses a two-phase protocol. First submit the complete operation list with `dryRun: true`; the server performs a read-only preflight, resolves every selector, and returns the canonical `resolvedPlan` and lowercase SHA-256 `planHash`. After reviewing that evidence, repeat the same operations with `dryRun: false`, `confirm: true`, and the returned hash. The server rebuilds the plan and performs no write unless the hash still matches.

Every operation requires `expectedUpdatedAt`. A plan may contain 1–20 operations, each affecting a different mutation-subject issue and producing at most one write. Supported kinds are `update_issue`, `set_custom_field`, `set_issue_state`, `set_assignee`, `add_tag`, `remove_tag`, `add_link`, and `remove_link`.

Confirmed execution is desired-state idempotent: an exact state already reached is reported as `already_satisfied` without a write. Otherwise, each non-retried write is followed by a reconciliation read. Callers must inspect every step and `partialCompletion`; the tool provides neither a transaction nor rollback.

See [tools](docs/tools.md), [safety](docs/safety.md), and [testing](docs/testing.md).

## Development

```bash
npm ci
npm run verify
npm pack
npm run smoke:packed -- ./6reduk-youtrack-mcp-*.tgz
```

Live mutation tests are disabled and deliberately stop before network writes until an exact call manifest receives separate approval.

## License

MIT. See [LICENSE](LICENSE).
