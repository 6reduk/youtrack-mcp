# Testing

`npm run verify` runs type checking, linting, unit/contract/protocol tests, build, secret/installation scans, and tarball allowlist validation.

Read-only live checks require `YOUTRACK_LIVE_READ_TESTS=1`. Mutation tests additionally require an exact sandbox project, unique `mcp-live-*` prefix, and a matching approval value. Current mutation test files intentionally stop before any network mutation.

Generate a secret-free plan with:

```bash
YOUTRACK_LIVE_MUTATION_PROJECT=SANDBOX \
YOUTRACK_LIVE_MUTATION_PREFIX=mcp-live-unique-run \
npm run live:mutation:manifest
```

No automated cleanup exists; approved live artifacts must be archived and cleaned manually.
