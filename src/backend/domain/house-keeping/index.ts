import type { ConfigRepository } from "@/backend/infra/config";
import type { EventBus } from "@/backend/infra/event-bus";
import { logger } from "@/backend/infra/logger";
import type { SessionService } from "../sessions";
import type { WorktreeService } from "../worktrees";

const DEFAULT_INTERVAL_MS = 300_000; // 5 minutes

export class HouseKeepingService {
  private isSyncing = false;

  constructor(
    private sessionService: SessionService,
    private worktreeService: WorktreeService,
    private configRepositories: ConfigRepository[],
    private eventBus: EventBus,
  ) {}

  async runHouseKeeping(repoPath: string): Promise<void> {
    if (this.isSyncing) {
      return;
    }

    this.beginSync();
    try {
      let removedBranches: string[] = [];
      try {
        removedBranches =
          await this.worktreeService.cleanMergedWorktrees(repoPath);
        if (removedBranches.length > 0) {
          logger.info(
            { repoPath, removedBranches },
            "Cleaned merged worktrees",
          );
        }
      } catch (err) {
        logger.error({ err, repoPath }, "Failed to clean merged worktrees");
      }

      let orphanedBranches: string[] = [];
      try {
        const persistedBranches =
          this.sessionService.listPersistedWorktreeBranches(repoPath);
        const liveBranches = new Set(
          (await this.worktreeService.listWorktrees(repoPath)).map(
            (worktree) => worktree.branch,
          ),
        );
        orphanedBranches = persistedBranches.filter(
          (branch) => !liveBranches.has(branch),
        );

        if (orphanedBranches.length > 0) {
          logger.info(
            { repoPath, orphanedBranches },
            "Found orphaned worktree data",
          );
        }
      } catch (err) {
        logger.error(
          { err, repoPath },
          "Failed to discover orphaned worktree data",
        );
      }

      const branchesToDelete = [
        ...new Set([...removedBranches, ...orphanedBranches]),
      ];

      if (branchesToDelete.length > 0) {
        try {
          await this.sessionService.deleteWorktreeData(
            repoPath,
            branchesToDelete,
          );
        } catch (err) {
          logger.error({ err, repoPath }, "Failed to delete worktree data");
        }
      }

      try {
        const result =
          await this.worktreeService.pullMainBranchIfOutdated(repoPath);
        if (result === "pulled") {
          logger.info({ repoPath }, "Pulled main branch");
        }
      } catch (err) {
        logger.error({ err, repoPath }, "Failed to pull main branch");
      }
    } finally {
      this.endSync();
    }
  }

  private beginSync(): void {
    this.isSyncing = true;
    this.eventBus.emit("house-keeping.sync-status-changed", {
      syncing: true,
    });
  }

  private endSync(): void {
    this.isSyncing = false;
    this.eventBus.emit("house-keeping.sync-status-changed", {
      syncing: false,
    });
  }

  startPeriodicHouseKeeping(): void {
    const intervalMs =
      Number(process.env.AITM_HOUSE_KEEPING_INTERVAL_MS) || DEFAULT_INTERVAL_MS;

    const run = async () => {
      for (const repo of this.configRepositories) {
        await this.runHouseKeeping(repo.path);
      }
    };

    run().catch((err) => {
      logger.error({ err }, "Unexpected house-keeping error");
    });
    setInterval(() => {
      run().catch((err) => {
        logger.error({ err }, "Unexpected house-keeping error");
      });
    }, intervalMs);
  }
}
