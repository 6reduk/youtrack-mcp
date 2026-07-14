# Contributing

1. Create a focused branch and avoid installation-specific IDs, field names, or workflow assumptions.
2. Add tests for both success and zero-write failure paths.
3. Run `npm ci` and `npm run verify` on Node.js 22 or 24.
4. Never add credentials or live mutation artifacts containing private data.
5. Explain new write semantics, idempotency, uncertainty handling, and verification in the pull request.

Live YouTrack mutations, package publication, tags, and releases require separate maintainer approval.
