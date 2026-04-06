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
  const branchSet = new Set(worktrees.map((w) => w.branch));

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

  // Build groups for each worktree
  const groups: WorktreeGroup[] = worktrees.map((worktree) => {
    const branchRuns = runsByBranch.get(worktree.branch) ?? [];
    return {
      worktree,
      runs: branchRuns,
      hasRunningWorkflow: branchRuns.some((r) => r.status === "running"),
    };
  });

  // Sort: main first, then worktrees with running workflows, then alphabetically
  groups.sort((a, b) => {
    if (a.worktree!.is_main !== b.worktree!.is_main) {
      return a.worktree!.is_main ? -1 : 1;
    }
    if (a.hasRunningWorkflow !== b.hasRunningWorkflow) {
      return a.hasRunningWorkflow ? -1 : 1;
    }
    return a.worktree!.branch.localeCompare(b.worktree!.branch);
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
