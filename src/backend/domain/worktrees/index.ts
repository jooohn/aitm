import { execFileSync } from "child_process";
import { logger } from "@/backend/infra/logger";

export interface Worktree {
  branch: string;
  path: string;
  is_main: boolean;
  is_bare: boolean;
  head: string;
}

export function parseWorktreeList(output: string): Worktree[] {
  const blocks = output.trim().split(/\n\n+/);
  if (blocks.length === 1 && blocks[0] === "") return [];

  return blocks
    .filter((block) => block.trim() !== "")
    .map((block, index) => {
      const lines = block.split("\n");
      const path = lines[0]?.replace(/^worktree /, "") ?? "";
      let head = "";
      let branch = "";
      let is_bare = false;

      for (const line of lines.slice(1)) {
        if (line.startsWith("HEAD ")) {
          head = line.slice(5, 12); // first 7 chars
        } else if (line.startsWith("branch refs/heads/")) {
          branch = line.slice("branch refs/heads/".length);
        } else if (line === "bare") {
          is_bare = true;
        }
      }

      return {
        branch,
        path,
        is_main: index === 0,
        is_bare,
        head,
      };
    });
}

function handleGtrCommandError(err: unknown) {
  const nodeErr = err as NodeJS.ErrnoException;
  if (nodeErr.code === "ENOENT") {
    throw new Error(
      "git-worktree-runner is not installed. Install it by following the Quick Start instruction (https://github.com/coderabbitai/git-worktree-runner?tab=readme-ov-file#quick-start).",
    );
  }
  const stderr =
    (err as { stderr?: string }).stderr?.trim() ??
    (err instanceof Error ? err.message : String(err));
  throw new Error(stderr);
}

export class WorktreeService {
  listWorktrees(repoPath: string): Worktree[] {
    const output = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: repoPath,
      encoding: "utf8",
    });
    return parseWorktreeList(output);
  }

  findWorktree(repoPath: string, branch: string): Worktree | undefined {
    return this.listWorktrees(repoPath).find((w) => w.branch === branch);
  }

  createWorktree(
    repoPath: string,
    branch: string,
    options?: { name?: string; no_fetch?: boolean },
  ): Worktree {
    const args = ["gtr", "new", branch];
    if (options?.name) args.push("--name", options.name);
    if (options?.no_fetch) args.push("--no-fetch");

    try {
      execFileSync("git", args, { cwd: repoPath, encoding: "utf8" });
    } catch (err) {
      handleGtrCommandError(err);
    }

    const worktrees = this.listWorktrees(repoPath);
    const created = worktrees.find((w) => w.branch === branch);
    if (!created) {
      throw new Error(
        `Worktree for branch "${branch}" not found after creation`,
      );
    }
    return created;
  }

  removeWorktree(repoPath: string, branch: string): void {
    const worktrees = this.listWorktrees(repoPath);
    const target = worktrees.find((w) => w.branch === branch);

    if (!target) {
      throw new Error(`Worktree not found for branch: ${branch}`);
    }
    if (target.is_main) {
      throw new Error(
        `Cannot remove the main worktree: "${branch}" is the main worktree`,
      );
    }

    try {
      execFileSync("git", ["gtr", "rm", branch], {
        cwd: repoPath,
        encoding: "utf8",
      });
    } catch (err) {
      handleGtrCommandError(err);
    }
  }

  cleanMergedWorktrees(repoPath: string): string[] {
    const before = this.listWorktrees(repoPath).map((w) => w.branch);
    try {
      execFileSync("git", ["gtr", "clean", "--merged", "--yes"], {
        cwd: repoPath,
        encoding: "utf8",
      });
    } catch (err) {
      handleGtrCommandError(err);
    }
    const after = new Set(this.listWorktrees(repoPath).map((w) => w.branch));
    return before.filter((b) => !after.has(b));
  }

  pullMainBranchIfOutdated(repoPath: string): "up-to-date" | "pulled" {
    const worktrees = this.listWorktrees(repoPath);
    const main = worktrees.find((w) => w.is_main);
    if (!main) {
      throw new Error(`No main worktree found in ${repoPath}`);
    }
    if (main.is_bare) {
      logger.warn({ repoPath }, "Skipping pull for bare main worktree");
      return "up-to-date";
    }

    execFileSync("git", ["fetch", "origin"], {
      cwd: main.path,
      encoding: "utf8",
    });

    let mergeOutput: string;
    try {
      mergeOutput = execFileSync("git", ["merge", "--ff-only", "@{u}"], {
        cwd: main.path,
        encoding: "utf8",
      });
    } catch (err) {
      const stderr =
        (err as { stderr?: string }).stderr?.trim() ??
        (err instanceof Error ? err.message : String(err));
      throw new Error(`Failed to fast-forward main branch: ${stderr}`);
    }

    if (mergeOutput.trim() === "Already up to date.") {
      return "up-to-date";
    }
    return "pulled";
  }
}
