# Safety and recovery

## Before a write

1. Discover the target project schema and exact candidates.
2. Build a pipeline or lifecycle in an external skill/configuration layer.
3. Call the mutation with `dryRun: true`.
4. For an existing issue, pass the observed `updatedAt` as `expectedUpdatedAt` when available.
5. Obtain user approval for the resolved target and change.

## After a write

The server performs a read-after-write check. Never automatically repeat a write when the result is `failed`, `uncertain_write`, or `partial_mutation`. Read the target again and compare the journal with the requested postconditions.

Parent replacement is intentionally non-atomic: removing an old parent can succeed while adding the new parent fails. The journal records both steps and no guessed rollback occurs.

Tag sharing settings are rejected until their write contract is proven for the connected YouTrack API. Adding a tag never creates it.
