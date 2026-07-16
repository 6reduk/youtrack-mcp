# Safety and recovery

## Before a write

1. Discover the target project schema and exact candidates.
2. Build a pipeline or lifecycle in an external skill/configuration layer.
3. Call the mutation with `dryRun: true`.
4. For an existing issue, pass the observed `updatedAt` as `expectedUpdatedAt` when available.
5. Obtain user approval for the resolved target and change.

For `youtrack_execute_plan`, approval is a strict two-phase protocol:

1. Read every target and retain its visible `updatedAt`.
2. Submit all 1–20 desired-state operations with `dryRun: true`. Do not include `planHash` or `confirm: true`.
3. Review the complete `resolvedPlan`, exact IDs, operation order, warnings, possible write count, non-transactional semantics, and every planned step.
4. Obtain explicit approval for that exact resolved plan and its returned hash.
5. Repeat the original operations with `dryRun: false`, `confirm: true`, and exactly that `planHash`.

Do not approve only a human-readable summary. The hash protects canonical resolved semantics, but not warnings, display names, snapshots, or journals. A hash mismatch is a safe zero-write conflict: create and approve a fresh preview instead of substituting the newly observed hash automatically.

## After a write

The server performs a read-after-write check. Never automatically repeat a write when the result is `failed`, `uncertain_write`, `partial_mutation`, or `partial_execution`. Read the target again and compare the journal with the requested postconditions.

For a confirmed plan, only a verified `updated` or verified `already_satisfied` step permits the next step. Writes are sequential and non-retried. At the first conflict, forbidden result, failure, or uncertainty, the tool stops and marks untouched operations `skipped`. There is no transaction and no rollback.

If a write response is lost or uncertain, the server performs one reconciliation read. When the read proves the desired state, the step succeeds with `write_response_uncertain_reconciled`. When it cannot prove the state, the step is `uncertain` with non-retryable `uncertain_write`; do not blindly resubmit it.

If `partialCompletion` is true or the top-level error is `partial_execution`:

1. Treat earlier `updated`/verified steps as committed facts; no automatic compensation occurred.
2. Read every affected issue again and compare exact desired postconditions with per-step `before`, `after`, warnings, errors, and journal entries.
3. Resolve any `uncertain` step from authoritative current state before planning more writes.
4. Build a new plan only for remaining desired states, using current timestamps.
5. Run a new preview, obtain approval for its new hash, and confirm that new plan.

Replaying an original confirmed request is safe only to the extent that fresh complete reads prove operations `already_satisfied` or their original timestamp guards still match. Idempotency is desired-state based, not exactly-once delivery.

Parent replacement is intentionally non-atomic: removing an old parent can succeed while adding the new parent fails. The journal records both steps and no guessed rollback occurs.

Tag sharing settings are rejected until their write contract is proven for the connected YouTrack API. Adding a tag never creates it.
