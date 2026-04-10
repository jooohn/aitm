import { mkdir, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureExcludeEntry,
  resolveGitDir,
  resolveGitInfoDir,
} from "./git-exclude-manager";

describe("resolveGitDir", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(
      tmpdir(),
      `aitm-git-test-${Math.random().toString(36).slice(2)}`,
    );
  });

  it("returns .git path when .git is a directory", async () => {
    await mkdir(join(tempDir, ".git"), { recursive: true });

    const result = await resolveGitDir(tempDir);
    expect(result).toBe(join(tempDir, ".git"));
  });

  it("follows gitdir: indirection when .git is a file", async () => {
    const realGitDir = join(tempDir, "real-git-dir");
    await mkdir(realGitDir, { recursive: true });
    await mkdir(tempDir, { recursive: true });
    await writeFile(join(tempDir, ".git"), `gitdir: ${realGitDir}\n`, "utf8");

    const result = await resolveGitDir(tempDir);
    expect(result).toBe(realGitDir);
  });

  it("resolves relative gitdir paths", async () => {
    const realGitDir = join(tempDir, "parent", ".git", "worktrees", "wt1");
    await mkdir(realGitDir, { recursive: true });
    const wtDir = join(tempDir, "wt1");
    await mkdir(wtDir, { recursive: true });
    await writeFile(
      join(wtDir, ".git"),
      "gitdir: ../parent/.git/worktrees/wt1\n",
      "utf8",
    );

    const result = await resolveGitDir(wtDir);
    // Should resolve relative to wtDir
    expect(result).toBe(join(wtDir, "../parent/.git/worktrees/wt1"));
  });

  it("throws when .git file has invalid content", async () => {
    await mkdir(tempDir, { recursive: true });
    await writeFile(join(tempDir, ".git"), "invalid content\n", "utf8");

    await expect(resolveGitDir(tempDir)).rejects.toThrow(
      "Failed to parse gitdir",
    );
  });
});

describe("resolveGitInfoDir", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(
      tmpdir(),
      `aitm-git-test-${Math.random().toString(36).slice(2)}`,
    );
  });

  it("returns .git/info for a regular (non-worktree) repo", async () => {
    await mkdir(join(tempDir, ".git"), { recursive: true });
    // No commondir file => regular repo

    const result = await resolveGitInfoDir(tempDir);
    expect(result).toBe(join(tempDir, ".git", "info"));
  });

  it("resolves shared info dir via commondir for worktrees", async () => {
    // Simulate a worktree: .git is a file pointing to the worktree git dir
    const mainGitDir = join(tempDir, "main-repo", ".git");
    const worktreeGitDir = join(mainGitDir, "worktrees", "wt1");
    await mkdir(worktreeGitDir, { recursive: true });

    // Write commondir pointing back to main .git
    await writeFile(join(worktreeGitDir, "commondir"), "../..\n", "utf8");

    const wtDir = join(tempDir, "wt1");
    await mkdir(wtDir, { recursive: true });
    await writeFile(join(wtDir, ".git"), `gitdir: ${worktreeGitDir}\n`, "utf8");

    const result = await resolveGitInfoDir(wtDir);
    // commondir "../.." relative to worktreeGitDir => mainGitDir
    expect(result).toBe(join(mainGitDir, "info"));
  });
});

describe("ensureExcludeEntry", () => {
  let tempDir: string;
  let infoDir: string;
  let excludePath: string;

  beforeEach(async () => {
    tempDir = join(
      tmpdir(),
      `aitm-exclude-test-${Math.random().toString(36).slice(2)}`,
    );
    infoDir = join(tempDir, "info");
    excludePath = join(infoDir, "exclude");
  });

  it("creates info dir and exclude file if they do not exist", async () => {
    await ensureExcludeEntry(infoDir, "/.aitm/runs/run-1/");

    const content = await readFile(excludePath, "utf8");
    expect(content).toBe("/.aitm/runs/run-1/\n");
  });

  it("appends entry to existing exclude file", async () => {
    await mkdir(infoDir, { recursive: true });
    await writeFile(excludePath, "# existing\n*.log\n", "utf8");

    await ensureExcludeEntry(infoDir, "/.aitm/runs/run-1/");

    const content = await readFile(excludePath, "utf8");
    expect(content).toBe("# existing\n*.log\n/.aitm/runs/run-1/\n");
  });

  it("does not duplicate an existing entry", async () => {
    await mkdir(infoDir, { recursive: true });
    await writeFile(excludePath, "/.aitm/runs/run-1/\n", "utf8");

    await ensureExcludeEntry(infoDir, "/.aitm/runs/run-1/");

    const content = await readFile(excludePath, "utf8");
    expect(content).toBe("/.aitm/runs/run-1/\n");
  });

  it("handles exclude file without trailing newline", async () => {
    await mkdir(infoDir, { recursive: true });
    await writeFile(excludePath, "*.log", "utf8");

    await ensureExcludeEntry(infoDir, "/.aitm/runs/run-1/");

    const content = await readFile(excludePath, "utf8");
    expect(content).toBe("*.log\n/.aitm/runs/run-1/\n");
  });
});
