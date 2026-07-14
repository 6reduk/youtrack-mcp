# Releasing

1. Update version and changelog using SemVer.
2. Run `npm ci` and `npm run verify` on Node.js 22 and 24.
3. Run `npm pack`, record its SHA-256 checksum, and run `npm run smoke:packed -- <tarball>`.
4. Review package contents and examples for credentials.
5. Commit and push only with explicit approval.
6. Create an annotated version tag and GitHub Release only with explicit approval.
7. Run the protected manual release workflow or `npm publish <tarball> --access public` only with explicit npm approval.

The release workflow uses `workflow_dispatch`; merging to `main` cannot publish a package.
