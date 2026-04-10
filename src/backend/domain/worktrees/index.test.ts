import { mkdir, realpath, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getContainer } from "@/backend/container";
import * as processUtils from "@/backend/utils/process";
import { SpawnTimeoutError, spawnAsync } from "@/backend/utils/process";
import {
  parseWorktreeList,
  resolveArtifactBasePath,
  resolveWorkflowRunDir,
  WorktreeService,
} from "./index";

const { worktreeService } = getContainer();
const listWorktrees = worktreeService.listWorktrees.bind(worktreeService);
const removeWorktree = worktreeService.removeWorktree.bind(worktreeService);

async function makeGitRepo(): Promise<string> {
  const d = join(tmpdir(), `aitm-test-${Math.random().toString(36).slice(2)}`);
  await mkdir(d, { recursive: true });
  const dir = await realpath(d);
  await spawnAsync("git", ["init"], { cwd: dir });
  await spawnAsync("git", ["config", "user.email", "test@test.com"], {
    cwd: dir,
  });
  await spawnAsync("git", ["config", "user.name", "Test"], { cwd: dir });
  await writeFile(join(dir, "README.md"), "# test");
  await spawnAsync("git", ["add", "."], { cwd: dir });
  await spawnAsync("git", ["commit", "-m", "init"], { cwd: dir });
  return dir;
}

// ---------------------------------------------------------------------------
// parseWorktreeList — pure unit tests, no subprocess
// ---------------------------------------------------------------------------

describe("parseWorktreeList", () => {
  it("returns empty array for empty output", () => {
    expect(parseWorktreeList("")).toEqual([]);
  });

  it("parses a single main worktree", () => {
    const output = [
      "worktree /home/alice/project",
      "HEAD abc1234def5678",
      "branch refs/heads/main",
      "",
    ].join("\n");

    expect(parseWorktreeList(output)).toEqual([
      {
        branch: "main",
        path: "/home/alice/project",
        is_main: true,
        is_bare: false,
        head: "abc1234",
      },
    ]);
  });

  it("parses multiple worktrees — only first is_main", () => {
    const output = [
      "worktree /home/alice/project",
      "HEAD abc1234def5678",
      "branch refs/heads/main",
      "",
      "worktree /home/alice/project-feat",
      "HEAD def5678abc1234",
      "branch refs/heads/feat/my-feature",
      "",
    ].join("\n");

    const result = parseWorktreeList(output);
    expect(result).toHaveLength(2);
    expect(result[0].is_main).toBe(true);
    expect(result[1].is_main).toBe(false);
    expect(result[1].branch).toBe("feat/my-feature");
  });

  it("strips refs/heads/ prefix from branch", () => {
    const output = [
      "worktree /home/alice/project",
      "HEAD abc1234def5678",
      "branch refs/heads/feat/nested/branch",
      "",
    ].join("\n");

    expect(parseWorktreeList(output)[0].branch).toBe("feat/nested/branch");
  });

  it("truncates HEAD SHA to 7 characters", () => {
    const output = [
      "worktree /home/alice/project",
      "HEAD abc1234def5678abcd",
      "branch refs/heads/main",
      "",
    ].join("\n");

    expect(parseWorktreeList(output)[0].head).toBe("abc1234");
  });

  it("marks bare worktrees and leaves branch empty", () => {
    const output = [
      "worktree /home/alice/project.git",
      "HEAD abc1234def5678",
      "bare",
      "",
    ].join("\n");

    const result = parseWorktreeList(output);
    expect(result[0].is_bare).toBe(true);
    expect(result[0].branch).toBe("");
  });
});

// ---------------------------------------------------------------------------
// listWorktrees — integration tests against real git repos
// ---------------------------------------------------------------------------

describe("listWorktrees", () => {
  it("returns the main worktree for a fresh repo", async () => {
    const dir = await makeGitRepo();
    const worktrees = await listWorktrees(dir);

    expect(worktrees).toHaveLength(1);
    expect(worktrees[0].is_main).toBe(true);
    expect(worktrees[0].path).toBe(dir);
    expect(worktrees[0].head).toHaveLength(7);
  });

  it("throws when repoPath is not a git repo", async () => {
    const d = join(
      tmpdir(),
      `aitm-test-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(d, { recursive: true });
    const dir = await realpath(d);
    await expect(listWorktrees(dir)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// removeWorktree — guard: cannot remove main worktree
// ---------------------------------------------------------------------------

describe("removeWorktree", () => {
  it("throws when trying to remove the main worktree", async () => {
    const dir = await makeGitRepo();
    const [main] = await listWorktrees(dir);

    await expect(removeWorktree(dir, main.branch)).rejects.toThrow(
      "is the main worktree",
    );
  });

  it("throws when the branch has no worktree", async () => {
    const dir = await makeGitRepo();
    await expect(removeWorktree(dir, "nonexistent-branch")).rejects.toThrow(
      "not found",
    );
  });
});

describe("resolveWorkflowRunDir", () => {
  it("resolves workflow run directory using worktree path and run id", () => {
    const worktree = {
      branch: "feat/test",
      path: "/worktrees/feat-test",
      is_main: false,
      is_bare: false,
      head: "HEAD",
    };

    const result = resolveWorkflowRunDir(worktree, "run-123");

    expect(result).toBe(
      join("/worktrees/feat-test", ".aitm", "runs", "run-123"),
    );
  });
});

describe("resolveArtifactBasePath", () => {
  it("resolves artifact base path using worktree path", () => {
    const worktree = {
      branch: "feat/test",
      path: "/worktrees/feat-test",
      is_main: false,
      is_bare: false,
      head: "HEAD",
    };

    const result = resolveArtifactBasePath(worktree, "run-123");

    expect(result).toBe(
      join("/worktrees/feat-test", ".aitm", "runs", "run-123", "artifacts"),
    );
  });
});

describe("pullMainBranchIfOutdated", () => {
  const repoPath = "/repo";
  const mainPath = "/repo/main";
  let service: WorktreeService;

  beforeEach(() => {
    service = new WorktreeService();
  });

  it("returns pulled after fetching and fast-forwarding the main worktree with a 10 second timeout", async () => {
    vi.spyOn(service, "listWorktrees").mockResolvedValue([
      {
        branch: "main",
        path: mainPath,
        is_main: true,
        is_bare: false,
        head: "abcdef0",
      },
    ]);

    const spawnSpy = vi
      .spyOn(processUtils, "spawnAsync")
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({
        code: 0,
        stdout: "Updating abc..def",
        stderr: "",
      });

    await expect(service.pullMainBranchIfOutdated(repoPath)).resolves.toBe(
      "pulled",
    );

    expect(spawnSpy).toHaveBeenNthCalledWith(1, "git", ["fetch", "origin"], {
      cwd: mainPath,
      timeoutMs: 10_000,
    });
    expect(spawnSpy).toHaveBeenNthCalledWith(
      2,
      "git",
      ["merge", "--ff-only", "@{u}"],
      { cwd: mainPath, timeoutMs: 10_000 },
    );
  });

  it("returns up-to-date when the main worktree is already current", async () => {
    vi.spyOn(service, "listWorktrees").mockResolvedValue([
      {
        branch: "main",
        path: mainPath,
        is_main: true,
        is_bare: false,
        head: "abcdef0",
      },
    ]);

    vi.spyOn(processUtils, "spawnAsync")
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({
        code: 0,
        stdout: "Already up to date.",
        stderr: "",
      });

    await expect(service.pullMainBranchIfOutdated(repoPath)).resolves.toBe(
      "up-to-date",
    );
  });

  it("surfaces a timeout error when the main-branch update hangs", async () => {
    vi.spyOn(service, "listWorktrees").mockResolvedValue([
      {
        branch: "main",
        path: mainPath,
        is_main: true,
        is_bare: false,
        head: "abcdef0",
      },
    ]);

    vi.spyOn(processUtils, "spawnAsync").mockRejectedValue(
      new SpawnTimeoutError("git", ["fetch", "origin"], 10_000),
    );

    await expect(service.pullMainBranchIfOutdated(repoPath)).rejects.toThrow(
      /timed out/i,
    );
  });

  it("surfaces a timeout error when the fast-forward step hangs", async () => {
    vi.spyOn(service, "listWorktrees").mockResolvedValue([
      {
        branch: "main",
        path: mainPath,
        is_main: true,
        is_bare: false,
        head: "abcdef0",
      },
    ]);

    vi.spyOn(processUtils, "spawnAsync")
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockRejectedValueOnce(
        new SpawnTimeoutError("git", ["merge", "--ff-only", "@{u}"], 10_000),
      );

    await expect(service.pullMainBranchIfOutdated(repoPath)).rejects.toThrow(
      /timed out/i,
    );
  });
});
