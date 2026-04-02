import { logger } from "@/backend/infra/logger";
import { spawnAsync } from "@/backend/utils/process";

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
  throw err instanceof Error ? err : new Error(String(err));
}

async function runGtrCommand(args: string[], cwd: string): Promise<string> {
  const { code, stdout, stderr } = await spawnAsync("git", args, { cwd });
  if (code !== 0) {
    throw new Error(stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return stdout;
}

export class WorktreeService {
  async listWorktrees(repoPath: string): Promise<Worktree[]> {
    const { code, stdout, stderr } = await spawnAsync(
      "git",
      ["worktree", "list", "--porcelain"],
      { cwd: repoPath },
    );
    if (code !== 0) {
      throw new Error(stderr.trim() || "git worktree list failed");
    }
    return parseWorktreeList(stdout);
  }

  async findWorktree(
    repoPath: string,
    branch: string,
  ): Promise<Worktree | undefined> {
    return (await this.listWorktrees(repoPath)).find(
      (w) => w.branch === branch,
    );
  }

  async createWorktree(
    repoPath: string,
    branch: string,
    options?: { name?: string; no_fetch?: boolean },
  ): Promise<Worktree> {
    const args = ["gtr", "new", branch];
    if (options?.name) args.push("--name", options.name);
    if (options?.no_fetch) args.push("--no-fetch");

    try {
      await runGtrCommand(args, repoPath);
    } catch (err) {
      handleGtrCommandError(err);
    }

    const worktrees = await this.listWorktrees(repoPath);
    const created = worktrees.find((w) => w.branch === branch);
    if (!created) {
      throw new Error(
        `Worktree for branch "${branch}" not found after creation`,
      );
    }
    return created;
  }

  async removeWorktree(repoPath: string, branch: string): Promise<void> {
    const worktrees = await this.listWorktrees(repoPath);
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
      await runGtrCommand(["gtr", "rm", branch], repoPath);
    } catch (err) {
      handleGtrCommandError(err);
    }
  }

  async cleanMergedWorktrees(repoPath: string): Promise<string[]> {
    const before = (await this.listWorktrees(repoPath)).map((w) => w.branch);
    try {
      await runGtrCommand(["gtr", "clean", "--merged", "--yes"], repoPath);
    } catch (err) {
      handleGtrCommandError(err);
    }
    const after = new Set(
      (await this.listWorktrees(repoPath)).map((w) => w.branch),
    );
    return before.filter((b) => !after.has(b));
  }

  async pullMainBranchIfOutdated(
    repoPath: string,
  ): Promise<"up-to-date" | "pulled"> {
    const worktrees = await this.listWorktrees(repoPath);
    const main = worktrees.find((w) => w.is_main);
    if (!main) {
      throw new Error(`No main worktree found in ${repoPath}`);
    }
    if (main.is_bare) {
      logger.warn({ repoPath }, "Skipping pull for bare main worktree");
      return "up-to-date";
    }

    await spawnAsync("git", ["fetch", "origin"], { cwd: main.path });

    const { code, stdout, stderr } = await spawnAsync(
      "git",
      ["merge", "--ff-only", "@{u}"],
      { cwd: main.path },
    );

    if (code !== 0) {
      throw new Error(
        `Failed to fast-forward main branch: ${stderr.trim() || stdout.trim()}`,
      );
    }

    if (stdout.trim() === "Already up to date.") {
      return "up-to-date";
    }
    return "pulled";
  }
}
