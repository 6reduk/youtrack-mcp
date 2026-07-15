# YouTrack MCP

Universal, schema-driven MCP server for YouTrack. It exposes neutral read and mutation tools without embedding a project workflow, parent task, custom-field name, link meaning, or company-specific identifier.

Read-only discovery includes agile board configuration and sprints, project-team membership, and observed issue activity history. These tools return only facts exposed by the public YouTrack REST API and never infer roles or permitted workflow transitions.

## Requirements

- Node.js 22 or 24
- A YouTrack permanent token with only the permissions required for intended operations
- `YOUTRACK_URL` and `YOUTRACK_TOKEN` in the MCP host environment

## Run

```bash
npx -y @6reduk/youtrack-mcp@0.1.3
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
- There is no bulk mutation, delete-issue, guessed rollback, or inferred workflow.

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
