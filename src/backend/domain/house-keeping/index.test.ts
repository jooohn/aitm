import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "@/backend/infra/event-bus";
import { HouseKeepingService } from "./index";

describe("HouseKeepingService.runHouseKeeping", () => {
  const repoPath = "/tmp/repo";
  const repoPaths = ["/tmp/repo-a", "/tmp/repo-b"];
  let eventBus: EventBus;
  let sessionService: {
    deleteWorktreeData: ReturnType<typeof vi.fn>;
    listPersistedWorktreeBranches: ReturnType<typeof vi.fn>;
  };
  let worktreeService: {
    cleanMergedWorktrees: ReturnType<typeof vi.fn>;
    listWorktrees: ReturnType<typeof vi.fn>;
    pullMainBranchIfOutdated: ReturnType<typeof vi.fn>;
  };
  let workflowRunService: {
    cleanupTerminalMainBranchRuns: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    eventBus = new EventBus();
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
    workflowRunService = {
      cleanupTerminalMainBranchRuns: vi.fn().mockResolvedValue(undefined),
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
      workflowRunService as never,
      [],
      eventBus,
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
      workflowRunService as never,
      [],
      eventBus,
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
      workflowRunService as never,
      [],
      eventBus,
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
      workflowRunService as never,
      [],
      eventBus,
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
      workflowRunService as never,
      [],
      eventBus,
    );

    await service.runHouseKeeping(repoPath);

    expect(sessionService.deleteWorktreeData).toHaveBeenCalledWith(repoPath, [
      "feat/merged",
    ]);
  });

  it("emits syncing notifications while house-keeping is running", async () => {
    const listener = vi.fn();
    eventBus.on("house-keeping.sync-status-changed", listener);

    let resolveCleanMerged: ((value: string[]) => void) | undefined;
    worktreeService.cleanMergedWorktrees.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          resolveCleanMerged = resolve;
        }),
    );

    const service = new HouseKeepingService(
      sessionService as never,
      worktreeService as never,
      workflowRunService as never,
      [],
      eventBus,
    );

    const runPromise = service.runHouseKeeping(repoPath);
    await Promise.resolve();

    expect(listener).toHaveBeenNthCalledWith(1, { syncing: true });

    resolveCleanMerged?.([]);
    await runPromise;

    expect(listener).toHaveBeenNthCalledWith(2, { syncing: false });
  });

  it("ignores overlapping runs while house-keeping is already active", async () => {
    const listener = vi.fn();
    eventBus.on("house-keeping.sync-status-changed", listener);

    let resolveFirst: ((value: string[]) => void) | undefined;
    worktreeService.cleanMergedWorktrees.mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const service = new HouseKeepingService(
      sessionService as never,
      worktreeService as never,
      workflowRunService as never,
      [],
      eventBus,
    );

    const firstRun = service.runHouseKeeping("/repos/org/repo-a");
    const secondRun = service.runHouseKeeping("/repos/org/repo-b");
    await Promise.resolve();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith({ syncing: true });
    expect(worktreeService.cleanMergedWorktrees).toHaveBeenCalledTimes(1);

    resolveFirst?.([]);
    await firstRun;
    await secondRun;

    expect(worktreeService.cleanMergedWorktrees).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith({ syncing: false });
  });

  it("runs a full house-keeping sweep across all configured repositories", async () => {
    const service = new HouseKeepingService(
      sessionService as never,
      worktreeService as never,
      workflowRunService as never,
      repoPaths.map((path) => ({ path })),
      eventBus,
    );

    await (
      service as { runAllRepositoriesOnce: () => Promise<void> }
    ).runAllRepositoriesOnce();

    expect(worktreeService.cleanMergedWorktrees).toHaveBeenNthCalledWith(
      1,
      repoPaths[0],
    );
    expect(worktreeService.cleanMergedWorktrees).toHaveBeenNthCalledWith(
      2,
      repoPaths[1],
    );
  });

  it("calls cleanupTerminalMainBranchRuns during house-keeping", async () => {
    const service = new HouseKeepingService(
      sessionService as never,
      worktreeService as never,
      workflowRunService as never,
      [],
      eventBus,
    );

    await service.runHouseKeeping(repoPath);

    expect(
      workflowRunService.cleanupTerminalMainBranchRuns,
    ).toHaveBeenCalledWith(repoPath);
  });

  it("continues house-keeping when cleanupTerminalMainBranchRuns fails", async () => {
    workflowRunService.cleanupTerminalMainBranchRuns.mockRejectedValue(
      new Error("cleanup failed"),
    );

    const service = new HouseKeepingService(
      sessionService as never,
      worktreeService as never,
      workflowRunService as never,
      [],
      eventBus,
    );

    await service.runHouseKeeping(repoPath);

    expect(
      workflowRunService.cleanupTerminalMainBranchRuns,
    ).toHaveBeenCalledWith(repoPath);
    // Should not throw — error is caught internally
  });
});
