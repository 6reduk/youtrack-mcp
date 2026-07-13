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
