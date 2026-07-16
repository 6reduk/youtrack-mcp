# Tool catalog

## Discovery and reads

`youtrack_get_server_info`, `youtrack_get_connection_config`, `youtrack_list_projects`, `youtrack_get_project`, `youtrack_get_project_schema`, `youtrack_get_issue`, `youtrack_search_issues`, `youtrack_list_issue_links`, `youtrack_list_issue_tags`, `youtrack_list_tags`, `youtrack_list_link_types`, `youtrack_list_subtasks`, and `youtrack_find_users`.

Agile audit reads:

- `youtrack_list_agile_boards` lists visible boards with bounded pagination, associated projects, board-status availability, and URLs. The official collection endpoint supports `$skip` and `$top`, but no discovery query.
- `youtrack_get_agile_board` resolves one board by `id` or unambiguous `exactName` and returns projects, column field and values, swimlanes, sprint/backlog settings, estimation fields, current sprint, and board status.
- `youtrack_list_sprints` resolves a board exactly and lists its sprints, including goal, dates, archived/default flags, and `current` when the board exposes a current sprint.
- `youtrack_get_project_team` resolves a project with `ProjectSelector`, then reads effective users, direct membership, direct groups, and visible project-scoped role assignments. YouTrack 2026.1+ uses the current project-team REST resources. When the primary effective-users endpoint returns 404, older servers fall back to the official same-origin Hub REST project-team resources. Hub project and team identities are resolved exactly; every compatibility request is GET-only. The response reports `source` and per-dimension `completeness`. Optional group, membership, or role permission failures are warnings after effective users are available; authentication, permission, transport, and server failures of the primary read are not masked as version mismatch.
- `youtrack_list_issue_activities` resolves an issue with `IssueSelector` and reads observed custom-field, resolution, sprint, tag, and link changes. `categories` uses official category IDs. `fieldNames` is an exact client-side filter over the upstream page because YouTrack has no activity-field query parameter.

`youtrack_get_project_schema` reports both the compatibility boolean `schemaComplete` and machine-readable `completeness`. An empty `admin_project_fields` response is `unavailable/source_empty`, not proof that the project has no fields. If an explicit same-project `probeIssue` reveals fields, they are merged as `partial/fallback_source`; issue metadata can never prove the complete project schema.

YouTrack does not expose an agile-board archived flag or the configured fields displayed on cards through the public REST entity. These are returned as `null` with warnings. The project-team APIs do not expose job titles. Assigned roles are returned only when the YouTrack role endpoint permits them; the Hub compatibility source does not infer cross-API role identity and returns roles as unavailable. Names, statuses, relationships, or allowed workflow transitions are never inferred. See the official [Agiles](https://www.jetbrains.com/help/youtrack/devportal/resource-api-agiles.html), [Sprints](https://www.jetbrains.com/help/youtrack/devportal/resource-api-agiles-agileID-sprints.html), [current project team users](https://www.jetbrains.com/help/youtrack/devportal/resource-api-admin-projects-projectID-team-users.html), [Hub project teams](https://www.jetbrains.com/help/youtrack/devportal/HUB-REST-API_Project-Teams_Get-All-Project-Teams.html), [Hub team users](https://www.jetbrains.com/help/youtrack/devportal/HUB-REST-API_Project-Teams_Users-of-Project-Team_Get-All-Users-of-a-Project-Team.html), [Hub team groups](https://www.jetbrains.com/help/youtrack/devportal/HUB-REST-API_Project-Teams_Groups-of-Project-Team_Get-All-Groups-of-a-Project-Team.html), [assigned roles](https://www.jetbrains.com/help/youtrack/devportal/resource-api-assignedRoles.html), [project custom fields](https://www.jetbrains.com/help/youtrack/devportal/resource-api-admin-projects-projectID-customFields.html), and [issue activities](https://www.jetbrains.com/help/youtrack/devportal/resource-api-issues-issueID-activities.html) references.

Read tools use bounded pagination. Exact selectors never silently select the first fuzzy candidate.

## Mutations

`youtrack_create_issue`, `youtrack_update_issue`, `youtrack_set_custom_field`, `youtrack_set_issue_state`, `youtrack_set_assignee`, `youtrack_add_link`, `youtrack_remove_link`, `youtrack_set_parent`, `youtrack_remove_parent`, `youtrack_add_tag`, `youtrack_remove_tag`, and `youtrack_create_tag`.

Mutation responses include status, target, before/after evidence, verification, warnings, journal, and a safe error. Callers must inspect these fields instead of assuming transport success means business success.

Custom-field mutations load the administrative project schema first. A complete schema keeps the strict global validation path. If that source is incomplete, an existing issue mutation uses the exact target issue as a same-project partial schema probe; `youtrack_create_issue` accepts an optional explicit `probeIssue`. Create without custom fields may proceed without a probe, leaving unknown required fields to YouTrack validation and defaults. Create with custom fields requires an exact same-project probe and accepts only fields and entity values positively observed there.

Partial evidence never proves that a field or value is absent project-wide, that an observed field is globally unique, or that required fields are complete. Therefore `youtrack_set_issue_state` and `youtrack_set_assignee` require an explicit `field` when fallback evidence is partial. An exact active, non-banned user may be sent when a probed user bundle is incomplete; YouTrack remains authoritative for assignability and the result is verified by a post-read. Missing, ambiguous, paginated, banned, or unknown-status user resolution fails before a write.

Machine-readable mutation warnings are:

- `schema_partial`: only request-scoped probe evidence was available.
- `required_fields_unverified`: create could not globally verify every required project field.
- `user_assignability_unverified`: the user was resolved exactly, but field assignability is delegated to YouTrack validation.

These warnings are preserved in dry-run, optimistic-conflict, uncertain-write reconciliation, missing post-read, and final verification results. `dryRun=true`, `expectedUpdatedAt`, the single-write limit, non-retried writes, and read-after-write verification apply equally to complete and partial schema paths.

Hierarchy tools require an exact link type and direction. The MCP does not decide which relation means parent, subtask, dependency, or workflow stage.
