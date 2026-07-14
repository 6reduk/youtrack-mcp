# Tool catalog

## Discovery and reads

`youtrack_get_server_info`, `youtrack_get_connection_config`, `youtrack_list_projects`, `youtrack_get_project`, `youtrack_get_project_schema`, `youtrack_get_issue`, `youtrack_search_issues`, `youtrack_list_issue_links`, `youtrack_list_issue_tags`, `youtrack_list_tags`, `youtrack_list_link_types`, `youtrack_list_subtasks`, and `youtrack_find_users`.

Read tools use bounded pagination. Exact selectors never silently select the first fuzzy candidate.

## Mutations

`youtrack_create_issue`, `youtrack_update_issue`, `youtrack_set_custom_field`, `youtrack_set_issue_state`, `youtrack_set_assignee`, `youtrack_add_link`, `youtrack_remove_link`, `youtrack_set_parent`, `youtrack_remove_parent`, `youtrack_add_tag`, `youtrack_remove_tag`, and `youtrack_create_tag`.

Mutation responses include status, target, before/after evidence, verification, warnings, journal, and a safe error. Callers must inspect these fields instead of assuming transport success means business success.

Hierarchy tools require an exact link type and direction. The MCP does not decide which relation means parent, subtask, dependency, or workflow stage.
