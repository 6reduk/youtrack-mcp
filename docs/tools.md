# Tool catalog

## Discovery and reads

`youtrack_get_server_info`, `youtrack_get_connection_config`, `youtrack_list_projects`, `youtrack_get_project`, `youtrack_get_project_schema`, `youtrack_get_issue`, `youtrack_search_issues`, `youtrack_list_issue_links`, `youtrack_list_issue_tags`, `youtrack_list_tags`, `youtrack_list_link_types`, `youtrack_list_subtasks`, and `youtrack_find_users`.

Agile audit reads:

- `youtrack_list_agile_boards` lists visible boards with bounded pagination, associated projects, board-status availability, and URLs. The official collection endpoint supports `$skip` and `$top`, but no discovery query.
- `youtrack_get_agile_board` resolves one board by `id` or unambiguous `exactName` and returns projects, column field and values, swimlanes, sprint/backlog settings, estimation fields, current sprint, and board status.
- `youtrack_list_sprints` resolves a board exactly and lists its sprints, including goal, dates, archived/default flags, and `current` when the board exposes a current sprint.
- `youtrack_get_project_team` resolves a project with `ProjectSelector`, then reads effective users, direct membership, direct groups, and visible project-scoped role assignments for users, groups, and the project-team holder. Project-team and assigned-role REST resources require YouTrack 2026.1 or newer. Partial group, membership, or role permission failures are warnings; failure of the primary users read is not hidden.
- `youtrack_list_issue_activities` resolves an issue with `IssueSelector` and reads observed custom-field, resolution, sprint, tag, and link changes. `categories` uses official category IDs. `fieldNames` is an exact client-side filter over the upstream page because YouTrack has no activity-field query parameter.

YouTrack does not expose an agile-board archived flag or the configured fields displayed on cards through the public REST entity. These are returned as `null` with warnings. The project-team API does not expose job titles; assigned roles are returned only when the separate role endpoint permits them and are otherwise `null` with a warning. Names, statuses, relationships, or allowed workflow transitions are never inferred. See the official [Agiles](https://www.jetbrains.com/help/youtrack/devportal/resource-api-agiles.html), [Sprints](https://www.jetbrains.com/help/youtrack/devportal/resource-api-agiles-agileID-sprints.html), [project team users](https://www.jetbrains.com/help/youtrack/devportal/resource-api-admin-projects-projectID-team-users.html), [project team groups](https://www.jetbrains.com/help/youtrack/devportal/resource-api-admin-projects-projectID-team-groups.html), [assigned roles](https://www.jetbrains.com/help/youtrack/devportal/resource-api-assignedRoles.html), and [issue activities](https://www.jetbrains.com/help/youtrack/devportal/resource-api-issues-issueID-activities.html) references.

Read tools use bounded pagination. Exact selectors never silently select the first fuzzy candidate.

## Mutations

`youtrack_create_issue`, `youtrack_update_issue`, `youtrack_set_custom_field`, `youtrack_set_issue_state`, `youtrack_set_assignee`, `youtrack_add_link`, `youtrack_remove_link`, `youtrack_set_parent`, `youtrack_remove_parent`, `youtrack_add_tag`, `youtrack_remove_tag`, and `youtrack_create_tag`.

Mutation responses include status, target, before/after evidence, verification, warnings, journal, and a safe error. Callers must inspect these fields instead of assuming transport success means business success.

Hierarchy tools require an exact link type and direction. The MCP does not decide which relation means parent, subtask, dependency, or workflow stage.
