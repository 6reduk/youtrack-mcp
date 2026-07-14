# Security policy

## Reporting

Do not open a public issue for a vulnerability or leaked credential. Use GitHub private vulnerability reporting for `6reduk/youtrack-mcp`. Revoke exposed YouTrack tokens immediately.

## Deployment guidance

- Use a dedicated least-privilege YouTrack token and inject it through the MCP host environment.
- Never put tokens in repository configuration, command arguments, logs, issue descriptions, or bug reports.
- Keep write-tool approval enabled in the MCP client.
- Use `dryRun` first and `expectedUpdatedAt` when updating an observed issue.
- Treat `failed` with `uncertain_write` or `partial_mutation` as a reconciliation task, not a reason to repeat the write.
- Pin an explicit package version; do not use `@latest` in durable configuration.

Supported security fixes target the latest released minor version.
