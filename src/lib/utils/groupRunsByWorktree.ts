import type { WorkflowRun, Worktree } from "@/lib/utils/api";

export interface WorktreeGroup {
  worktree: Worktree | null;
  runs: WorkflowRun[];
  hasRunningWorkflow: boolean;
}

export function groupRunsByWorktree(
  worktrees: Worktree[],
  runs: WorkflowRun[],
): WorktreeGroup[] {
  const nonMainWorktrees = worktrees.filter((w) => !w.is_main);
  const branchSet = new Set(nonMainWorktrees.map((w) => w.branch));

  // Bucket runs by branch
  const runsByBranch = new Map<string, WorkflowRun[]>();
  const orphanedRuns: WorkflowRun[] = [];
  for (const run of runs) {
    if (branchSet.has(run.worktree_branch)) {
      const bucket = runsByBranch.get(run.worktree_branch);
      if (bucket) {
        bucket.push(run);
      } else {
        runsByBranch.set(run.worktree_branch, [run]);
      }
    } else {
      orphanedRuns.push(run);
    }
  }

  // Build groups for each worktree (excluding main)
  const groups: WorktreeGroup[] = nonMainWorktrees.map((worktree) => {
    const branchRuns = runsByBranch.get(worktree.branch) ?? [];
    return {
      worktree,
      runs: branchRuns,
      hasRunningWorkflow: branchRuns.some((r) => r.status === "running"),
    };
  });

  // Sort by oldest workflow run created_at descending (most recently started worktrees first)
  function oldestRunTime(group: WorktreeGroup): string {
    if (group.runs.length === 0) return "";
    return group.runs.reduce(
      (min, r) => (r.created_at < min ? r.created_at : min),
      group.runs[0].created_at,
    );
  }

  groups.sort((a, b) => {
    const oldestA = oldestRunTime(a);
    const oldestB = oldestRunTime(b);
    if (!oldestA && !oldestB)
      return a.worktree!.branch.localeCompare(b.worktree!.branch);
    if (!oldestA) return 1;
    if (!oldestB) return -1;
    return oldestB.localeCompare(oldestA);
  });

  // Append orphaned group if any
  if (orphanedRuns.length > 0) {
    groups.push({
      worktree: null,
      runs: orphanedRuns,
      hasRunningWorkflow: orphanedRuns.some((r) => r.status === "running"),
    });
  }

  return groups;
}
