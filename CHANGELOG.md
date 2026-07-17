# Changelog

## 0.1.9 - 2026-07-17

- Start the CLI unconditionally so local npm/npx installs work when `node_modules/.bin/youtrack-mcp` is a symlink on macOS and Linux.
- Exercise the installed npm bin shim in packed smoke tests and cover symlink startup with a protocol regression test.

## 0.1.8 - 2026-07-16

- Add `youtrack_execute_plan`, a bounded two-phase batch tool with read-only preview, canonical SHA-256 `planHash`, explicit confirmation, exact selectors, and mandatory optimistic timestamp guards.
- Execute up to 20 distinct issue-subject desired-state operations sequentially with stateless `already_satisfied` replay, stop-on-error, non-retried writes, and read-after-write verification.
- Report uncertain writes and partial completion explicitly without transactions or guessed rollback, with regression coverage and operator recovery guidance.

## 0.1.7 - 2026-07-16

- Allow safe issue creation and custom-field updates when administrative project schema is partial, using explicit same-project or target-issue probe evidence without claiming completeness.
- Preserve machine-readable schema, required-field, and user-assignability warnings through dry-run, guards, writes, reconciliation, and verification.
- Require explicit fields for partial-schema state and assignee wrappers, and fail closed for ambiguous, paginated, banned, or unverified users.

## 0.1.6 - 2026-07-15

- Add one cross-platform version-bump command with consistency checks, regression coverage, and release documentation for macOS, Linux, and Windows.

## 0.1.5 - 2026-07-15

- Fall back to the official read-only Hub project-team API on pre-2026.1 YouTrack servers and report effective-user, direct-group, membership, role, and schema completeness explicitly.
- Preserve explicit probe-issue schema discovery when the administrative project-field source is empty or unavailable, without treating an empty administrative view as proof that no fields exist.

## 0.1.4 - 2026-07-15

- Add universal read-only agile board, sprint, project-team, and issue-activity audit tools with strict schemas, bounded pagination, exact resolution, tests, and documented API limitations.

## 0.1.3 - 2026-07-14

- Document the complete contributor workflow for versioning and automatic releases from `main`.

## 0.1.2 - 2026-07-14

- Make the packed smoke test independent of the current package version.
- Move GitHub Actions to their Node.js 24-based major versions.

## 0.1.1 - 2026-07-14

- Configure token-free npm Trusted Publishing through the protected GitHub Actions release workflow.
- Pin release execution to an exact version tag and verify package/tag version consistency.

## 0.1.0 - 2026-07-14

- Universal project/schema discovery and exact issue, link, tag, user, and project reads.
- Verified single-issue, custom-field, state, assignee, link, hierarchy, and tag mutations.
- Dry-run, optimistic timestamp guards, bounded reads, non-retried writes, reconciliation, and redaction.
- Codex, Claude Code, and Kimi CLI configuration examples.
