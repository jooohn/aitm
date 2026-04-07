export const swrKeys = {
  repositories: () => ["/api/repositories"] as const,
  repository: (org: string, name: string) =>
    ["/api/repositories", org, name] as const,
  worktrees: (org: string, name: string) =>
    ["/api/repositories", org, name, "worktrees"] as const,
  workflows: () => ["/api/workflows"] as const,
  workflowRuns: (
    params?: Partial<{
      repository_path: string;
      worktree_branch: string;
      status: string;
    }>,
  ) =>
    params
      ? (["/api/workflow-runs", params] as const)
      : (["/api/workflow-runs"] as const),
  workflowRun: (id: string) => ["/api/workflow-runs", id] as const,
  session: (id: string) => ["/api/sessions", id] as const,
};
