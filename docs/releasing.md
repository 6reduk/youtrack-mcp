# Releasing

1. Update version and changelog using SemVer.
2. Run `npm ci` and `npm run verify` on Node.js 22 and 24.
3. Run `npm pack`, record its SHA-256 checksum, and run `npm run smoke:packed -- <tarball>`.
4. Review package contents and examples for credentials.
5. Commit and push only with explicit approval.
6. Create an annotated version tag and GitHub Release only with explicit approval.
7. Run the protected manual release workflow or `npm publish <tarball> --access public` only with explicit npm approval.

The release workflow uses `workflow_dispatch`; merging to `main` cannot publish a package.

## npm trusted publishing

After the initial manual package publication, configure the package's npm Trusted Publisher with:

- provider: GitHub Actions;
- organization or user: `6reduk`;
- repository: `youtrack-mcp`;
- workflow filename: `release.yml`;
- environment: `npm-release`;
- allowed action: `npm publish`.

The workflow requires the exact SemVer input, checks out `v<version>`, verifies that `package.json` matches, and publishes through OIDC. No npm write token is stored in GitHub. After OIDC is proven, set npm Publishing access to disallow traditional tokens and revoke obsolete write tokens.
