# Releasing

1. Update version and changelog using SemVer.
2. Run `npm ci` and `npm run verify` on Node.js 22 and 24.
3. Run `npm pack`, record its SHA-256 checksum, and run `npm run smoke:packed -- <tarball>`.
4. Review package contents and examples for credentials.
5. Commit changes on a non-`main` branch until they are intended for release.
6. Bump `package.json`, lockfile, changelog, and MCP server version before merging or pushing to `main`.
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
