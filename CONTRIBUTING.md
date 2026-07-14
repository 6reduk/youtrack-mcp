# Contributing

1. Create a focused branch and avoid installation-specific IDs, field names, or workflow assumptions.
2. Add tests for both success and zero-write failure paths.
3. Run `npm ci` and `npm run verify` on Node.js 22 or 24.
4. Never add credentials or live mutation artifacts containing private data.
5. Explain new write semantics, idempotency, uncertainty handling, and verification in the pull request.

Live YouTrack mutations require separate maintainer approval.

## Preparing a release

`main` is release-only: every commit merged or pushed to `main` must contain a new, unpublished SemVer version. Keep experiments, incomplete work, and validation that must not publish a package on another branch or in a pull request.

1. Choose the next version according to SemVer and update `package.json` plus `package-lock.json` without creating a local tag:

   ```bash
   npm version <major|minor|patch|exact-version> --no-git-tag-version
   ```

2. Set the same version in `src/server/create-server.ts`, the install commands in `README.md`, and all files under `examples/`.
3. Add a dated entry for the version to `CHANGELOG.md`.
4. Install from the lockfile and run the complete verification suite:

   ```bash
   npm ci
   npm run verify
   ```

5. Build the actual publishable archive and verify a clean installation plus MCP stdio handshake from it:

   ```bash
   npm pack
   npm run smoke:packed -- ./6reduk-youtrack-mcp-<exact-version>.tgz
   ```

6. Review the diff and tarball contents for credentials, private data, and unintended files. Merge or push to `main` only when that exact commit is ready to publish.

The `Release` workflow reads the version from `package.json`, rejects reused versions or mismatched tags, repeats verification, creates `v<version>`, publishes to npm through GitHub OIDC, and creates a GitHub Release with the tarball and SHA-256 checksum. Do not create the tag or run `npm publish` manually. Merging or pushing a correctly versioned commit to `main` authorizes its automatic publication.
