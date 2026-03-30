import { execFileSync } from "child_process";

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

export function listWorktrees(repoPath: string): Worktree[] {
  const output = execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd: repoPath,
    encoding: "utf8",
  });
  return parseWorktreeList(output);
}

export function createWorktree(
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

  const worktrees = listWorktrees(repoPath);
  const created = worktrees.find((w) => w.branch === branch);
  if (!created) {
    throw new Error(`Worktree for branch "${branch}" not found after creation`);
  }
  return created;
}

export function removeWorktree(repoPath: string, branch: string): void {
  const worktrees = listWorktrees(repoPath);
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
