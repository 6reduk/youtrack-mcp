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
