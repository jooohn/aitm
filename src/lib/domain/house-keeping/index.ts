import { getConfigRepositories } from "../../infra/config";
import type { SessionService } from "../sessions";
import type { WorktreeService } from "../worktrees";

const DEFAULT_INTERVAL_MS = 300_000; // 5 minutes

export class HouseKeepingService {
  constructor(
    private sessionService: SessionService,
    private worktreeService: WorktreeService,
  ) {}

  async runHouseKeeping(repoPath: string): Promise<void> {
    let removedBranches: string[] = [];
    try {
      removedBranches = this.worktreeService.cleanMergedWorktrees(repoPath);
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
        this.sessionService.deleteWorktreeData(repoPath, removedBranches);
      } catch (err) {
        console.error(
          `[house-keeping] Failed to delete worktree data in ${repoPath}:`,
          err,
        );
      }
    }

    try {
      const result = this.worktreeService.pullMainBranchIfOutdated(repoPath);
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

  startPeriodicHouseKeeping(): void {
    const intervalMs =
      Number(process.env.AITM_HOUSE_KEEPING_INTERVAL_MS) || DEFAULT_INTERVAL_MS;

    const run = () => {
      const repos = getConfigRepositories();
      for (const repo of repos) {
        this.runHouseKeeping(repo.path).catch((err) => {
          console.error(
            `[house-keeping] Unexpected error for ${repo.path}:`,
            err,
          );
        });
      }
    };

    run();
    setInterval(run, intervalMs);
  }
}
