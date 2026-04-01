import { sessionService, worktreeService } from "../container";

export async function runHouseKeeping(repoPath: string): Promise<void> {
  let removedBranches: string[] = [];
  try {
    removedBranches = worktreeService.cleanMergedWorktrees(repoPath);
    if (removedBranches.length > 0) {
      console.log(
        `[house-keeping] Cleaned merged worktrees in ${repoPath}: ${removedBranches.join(", ")}`,
      );
    }
  } catch (err) {
    console.error(
      `[house-keeping] Failed to clean merged worktrees in ${repoPath}:`,
      err,
    );
  }

  if (removedBranches.length > 0) {
    try {
      sessionService.deleteWorktreeData(repoPath, removedBranches);
    } catch (err) {
      console.error(
        `[house-keeping] Failed to delete worktree data in ${repoPath}:`,
        err,
      );
    }
  }

  try {
    const result = worktreeService.pullMainBranchIfOutdated(repoPath);
    if (result === "pulled") {
      console.log(`[house-keeping] Pulled main branch in ${repoPath}`);
    }
  } catch (err) {
    console.error(
      `[house-keeping] Failed to pull main branch in ${repoPath}:`,
      err,
    );
  }
}
