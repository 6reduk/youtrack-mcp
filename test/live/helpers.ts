export function liveReadEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.YOUTRACK_LIVE_READ_TESTS === "1";
}

export function requireLiveProject(env: NodeJS.ProcessEnv = process.env): string {
  const project = env.YOUTRACK_LIVE_PROJECT?.trim();
  if (project === undefined || project.length === 0) {
    throw new Error("YOUTRACK_LIVE_PROJECT is required for project-scoped live reads");
  }
  return project;
}

export interface LiveMutationGate { readonly project: string; readonly runPrefix: string }
export function liveMutationEnabled(env: NodeJS.ProcessEnv = process.env): boolean { return env.YOUTRACK_LIVE_MUTATION_TESTS === "1"; }
export function requireLiveMutationGate(env: NodeJS.ProcessEnv = process.env): LiveMutationGate {
  if (!liveMutationEnabled(env)) throw new Error("YOUTRACK_LIVE_MUTATION_TESTS=1 is required");
  const project = env.YOUTRACK_LIVE_MUTATION_PROJECT?.trim();
  if (project === undefined || project.length === 0) throw new Error("YOUTRACK_LIVE_MUTATION_PROJECT is required");
  const runPrefix = env.YOUTRACK_LIVE_MUTATION_PREFIX?.trim();
  if (runPrefix === undefined || !/^mcp-live-[a-z0-9-]{8,64}$/.test(runPrefix)) throw new Error("YOUTRACK_LIVE_MUTATION_PREFIX must be a unique mcp-live-* value");
  if (env.YOUTRACK_LIVE_MUTATION_APPROVAL !== `${project}:${runPrefix}`) throw new Error("YOUTRACK_LIVE_MUTATION_APPROVAL must exactly match project:prefix");
  return { project, runPrefix };
}

export interface LivePartialSchemaDryRunGate {
  readonly project: string;
  readonly probeIssue: string;
  readonly targetIssue: string;
  readonly stateFieldId: string;
  readonly stateValueId: string;
}

export function livePartialSchemaDryRunsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.YOUTRACK_LIVE_PARTIAL_SCHEMA_DRY_RUNS === "1";
}

export function requireLivePartialSchemaDryRunGate(env: NodeJS.ProcessEnv = process.env): LivePartialSchemaDryRunGate {
  if (!livePartialSchemaDryRunsEnabled(env)) throw new Error("YOUTRACK_LIVE_PARTIAL_SCHEMA_DRY_RUNS=1 is required");
  const read = (name: keyof NodeJS.ProcessEnv): string => {
    const value = env[name]?.trim();
    if (value === undefined || value.length === 0) throw new Error(`${String(name)} is required`);
    return value;
  };
  return {
    project: read("YOUTRACK_LIVE_PARTIAL_PROJECT"),
    probeIssue: read("YOUTRACK_LIVE_PARTIAL_PROBE_ISSUE"),
    targetIssue: read("YOUTRACK_LIVE_PARTIAL_TARGET_ISSUE"),
    stateFieldId: read("YOUTRACK_LIVE_PARTIAL_STATE_FIELD_ID"),
    stateValueId: read("YOUTRACK_LIVE_PARTIAL_STATE_VALUE_ID"),
  };
}
