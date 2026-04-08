import { beforeEach, describe, expect, it, vi } from "vitest";
import { HouseKeepingService } from "./index";

describe("HouseKeepingService.runHouseKeeping", () => {
  const repoPath = "/tmp/repo";
  let sessionService: {
    deleteWorktreeData: ReturnType<typeof vi.fn>;
    listPersistedWorktreeBranches: ReturnType<typeof vi.fn>;
  };
  let worktreeService: {
    cleanMergedWorktrees: ReturnType<typeof vi.fn>;
    listWorktrees: ReturnType<typeof vi.fn>;
    pullMainBranchIfOutdated: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    sessionService = {
      deleteWorktreeData: vi.fn().mockResolvedValue(undefined),
      listPersistedWorktreeBranches: vi.fn().mockReturnValue([]),
    };
    worktreeService = {
      cleanMergedWorktrees: vi.fn().mockResolvedValue([]),
      listWorktrees: vi.fn().mockResolvedValue([
        {
          branch: "main",
          path: repoPath,
          is_main: true,
          is_bare: false,
          head: "1234567",
        },
      ]),
      pullMainBranchIfOutdated: vi.fn().mockResolvedValue("up-to-date"),
    };
  });

  it("deletes orphaned worktree data when persisted branches no longer exist", async () => {
    sessionService.listPersistedWorktreeBranches.mockReturnValue([
      "feat/live",
      "feat/orphan",
    ]);
    worktreeService.listWorktrees.mockResolvedValue([
      {
        branch: "main",
        path: repoPath,
        is_main: true,
        is_bare: false,
        head: "1234567",
      },
      {
        branch: "feat/live",
        path: `${repoPath}/../repo-live`,
        is_main: false,
        is_bare: false,
        head: "2345678",
      },
    ]);

    const service = new HouseKeepingService(
      sessionService as never,
      worktreeService as never,
      [],
    );

    await service.runHouseKeeping(repoPath);

    expect(sessionService.deleteWorktreeData).toHaveBeenCalledOnce();
    expect(sessionService.deleteWorktreeData).toHaveBeenCalledWith(repoPath, [
      "feat/orphan",
    ]);
  });

  it("de-duplicates merged and orphaned branches before deleting worktree data", async () => {
    sessionService.listPersistedWorktreeBranches.mockReturnValue([
      "feat/merged",
      "feat/orphan",
    ]);
    worktreeService.cleanMergedWorktrees.mockResolvedValue(["feat/merged"]);
    worktreeService.listWorktrees.mockResolvedValue([
      {
        branch: "main",
        path: repoPath,
        is_main: true,
        is_bare: false,
        head: "1234567",
      },
    ]);

    const service = new HouseKeepingService(
      sessionService as never,
      worktreeService as never,
      [],
    );

    await service.runHouseKeeping(repoPath);

    expect(sessionService.deleteWorktreeData).toHaveBeenCalledWith(
      repoPath,
      expect.arrayContaining(["feat/merged", "feat/orphan"]),
    );
    expect(sessionService.deleteWorktreeData.mock.calls[0]?.[1]).toHaveLength(
      2,
    );
  });

  it("does not delete worktree data when all persisted branches still exist", async () => {
    sessionService.listPersistedWorktreeBranches.mockReturnValue([
      "main",
      "feat/live",
    ]);
    worktreeService.listWorktrees.mockResolvedValue([
      {
        branch: "main",
        path: repoPath,
        is_main: true,
        is_bare: false,
        head: "1234567",
      },
      {
        branch: "feat/live",
        path: `${repoPath}/../repo-live`,
        is_main: false,
        is_bare: false,
        head: "2345678",
      },
    ]);

    const service = new HouseKeepingService(
      sessionService as never,
      worktreeService as never,
      [],
    );

    await service.runHouseKeeping(repoPath);

    expect(sessionService.deleteWorktreeData).not.toHaveBeenCalled();
  });

  it("still deletes orphaned data when merged cleanup fails", async () => {
    sessionService.listPersistedWorktreeBranches.mockReturnValue([
      "feat/orphan",
    ]);
    worktreeService.cleanMergedWorktrees.mockRejectedValue(
      new Error("git clean failed"),
    );

    const service = new HouseKeepingService(
      sessionService as never,
      worktreeService as never,
      [],
    );

    await service.runHouseKeeping(repoPath);

    expect(sessionService.deleteWorktreeData).toHaveBeenCalledWith(repoPath, [
      "feat/orphan",
    ]);
  });

  it("still deletes merged branches when orphan discovery fails", async () => {
    worktreeService.cleanMergedWorktrees.mockResolvedValue(["feat/merged"]);
    worktreeService.listWorktrees.mockRejectedValue(
      new Error("git list failed"),
    );

    const service = new HouseKeepingService(
      sessionService as never,
      worktreeService as never,
      [],
    );

    await service.runHouseKeeping(repoPath);

    expect(sessionService.deleteWorktreeData).toHaveBeenCalledWith(repoPath, [
      "feat/merged",
    ]);
  });
});
