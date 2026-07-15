# Releasing

1. Keep pending release notes under `## Unreleased` in `CHANGELOG.md`, then bump every release reference with one cross-platform command:

   ```bash
   npm run version:bump -- patch
   ```

   Use `minor`, `major`, or an explicit stable SemVer such as `0.2.0` instead of `patch` when appropriate. The command works unchanged in macOS/Linux shells, Windows PowerShell, and `cmd.exe` because npm launches a Node.js script. Use `--dry-run` to preview and `--date YYYY-MM-DD` to override the local release date.
2. Run `npm ci` and `npm run verify` on Node.js 22 and 24.
3. Run `npm pack`, record its SHA-256 checksum, and run `npm run smoke:packed -- <tarball>`.
4. Review package contents and examples for credentials.
5. Commit changes on a non-`main` branch until they are intended for release.
6. Confirm `npm run version:check` succeeds before merging or pushing to `main`. It verifies `package.json`, the lockfile, changelog, MCP server metadata, README, and all client examples use the same version.
7. Push to `main`; the protected release environment verifies, tags, publishes through npm OIDC, and creates the GitHub Release.

`main` is release-only. Every new commit on `main` must carry an unpublished package version. Development, experiments, and non-publishing validation use other branches.

## npm trusted publishing

After the initial manual package publication, configure the package's npm Trusted Publisher with:

- provider: GitHub Actions;
- organization or user: `6reduk`;
- repository: `youtrack-mcp`;
- workflow filename: `release.yml`;
- environment: `npm-release`;
- allowed action: `npm publish`.

The workflow derives the exact SemVer from `package.json`, rejects reused versions/tags, runs the complete verification and packed handshake, creates `v<version>`, and publishes through OIDC. It then creates a GitHub Release with the tarball and SHA-256. No npm write token is stored in GitHub. After OIDC is proven, set npm Publishing access to disallow traditional tokens and revoke obsolete write tokens.
