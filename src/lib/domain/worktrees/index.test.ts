import { execFileSync } from "child_process";
import { mkdirSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { worktreeService } from "@/lib/container";
import { parseWorktreeList } from "./index";

const listWorktrees = worktreeService.listWorktrees.bind(worktreeService);
const removeWorktree = worktreeService.removeWorktree.bind(worktreeService);

function makeGitRepo(): string {
  const dir = realpathSync(
    (() => {
      const d = join(
        tmpdir(),
        `aitm-test-${Math.random().toString(36).slice(2)}`,
      );
      mkdirSync(d, { recursive: true });
      return d;
    })(),
  );
  execFileSync("git", ["init"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# test");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir });
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
  it("returns the main worktree for a fresh repo", () => {
    const dir = makeGitRepo();
    const worktrees = listWorktrees(dir);

    expect(worktrees).toHaveLength(1);
    expect(worktrees[0].is_main).toBe(true);
    expect(worktrees[0].path).toBe(dir);
    expect(worktrees[0].head).toHaveLength(7);
  });

  it("throws when repoPath is not a git repo", () => {
    const dir = realpathSync(
      (() => {
        const d = join(
          tmpdir(),
          `aitm-test-${Math.random().toString(36).slice(2)}`,
        );
        mkdirSync(d, { recursive: true });
        return d;
      })(),
    );
    expect(() => listWorktrees(dir)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// removeWorktree — guard: cannot remove main worktree
// ---------------------------------------------------------------------------

describe("removeWorktree", () => {
  it("throws when trying to remove the main worktree", () => {
    const dir = makeGitRepo();
    const [main] = listWorktrees(dir);

    expect(() => removeWorktree(dir, main.branch)).toThrow(
      "is the main worktree",
    );
  });

  it("throws when the branch has no worktree", () => {
    const dir = makeGitRepo();
    expect(() => removeWorktree(dir, "nonexistent-branch")).toThrow(
      "not found",
    );
  });
});
