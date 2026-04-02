import { getConfigRepositories } from "@/backend/infra/config";
import { logger } from "@/backend/infra/logger";
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
        logger.info({ repoPath, removedBranches }, "Cleaned merged worktrees");
      }
    } catch (err) {
      logger.error({ err, repoPath }, "Failed to clean merged worktrees");
    }

    if (removedBranches.length > 0) {
      try {
        this.sessionService.deleteWorktreeData(repoPath, removedBranches);
      } catch (err) {
        logger.error({ err, repoPath }, "Failed to delete worktree data");
      }
    }

    try {
      const result = this.worktreeService.pullMainBranchIfOutdated(repoPath);
      if (result === "pulled") {
        logger.info({ repoPath }, "Pulled main branch");
      }
    } catch (err) {
      logger.error({ err, repoPath }, "Failed to pull main branch");
    }
  }

  startPeriodicHouseKeeping(): void {
    const intervalMs =
      Number(process.env.AITM_HOUSE_KEEPING_INTERVAL_MS) || DEFAULT_INTERVAL_MS;

    const run = () => {
      const repos = getConfigRepositories();
      for (const repo of repos) {
        this.runHouseKeeping(repo.path).catch((err) => {
          logger.error(
            { err, repoPath: repo.path },
            "Unexpected house-keeping error",
          );
        });
      }
    };

    run();
    setInterval(run, intervalMs);
  }
}
