import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpawnResult } from "@/backend/utils/process";
import { GitHubBranchService } from ".";

const mockFetch = vi.fn();
const mockSpawnAsync =
  vi.fn<
    (
      command: string,
      args: string[],
      options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
    ) => Promise<SpawnResult>
  >();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.GITHUB_TOKEN;
});

describe("GitHubBranchService", () => {
  const service = new GitHubBranchService(mockSpawnAsync);

  describe("fetchBranchesWithOpenPRs", () => {
    it("returns branches with open PRs from the GitHub API", async () => {
      process.env.GITHUB_TOKEN = "ghp_test123";
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [
          {
            number: 42,
            title: "Add dark mode",
            head: { ref: "feature/dark-mode" },
          },
          {
            number: 15,
            title: "Fix login bug",
            head: { ref: "fix/login-bug" },
          },
        ],
      });

      const result = await service.fetchBranchesWithOpenPRs("myorg", "myrepo");

      expect(result).toEqual([
        {
          branch: "feature/dark-mode",
          pr_number: 42,
          pr_title: "Add dark mode",
        },
        {
          branch: "fix/login-bug",
          pr_number: 15,
          pr_title: "Fix login bug",
        },
      ]);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/myorg/myrepo/pulls?state=open&per_page=100",
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: "Bearer ghp_test123",
          },
        },
      );
    });

    it("throws when GitHub API returns an error", async () => {
      process.env.GITHUB_TOKEN = "ghp_test123";
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: async () => "rate limit exceeded",
      });

      await expect(
        service.fetchBranchesWithOpenPRs("myorg", "myrepo"),
      ).rejects.toThrow();
    });

    it("lets fetch exceptions propagate", async () => {
      process.env.GITHUB_TOKEN = "ghp_test123";
      mockFetch.mockRejectedValue(new Error("Network error"));

      await expect(
        service.fetchBranchesWithOpenPRs("myorg", "myrepo"),
      ).rejects.toThrow("Network error");
    });

    describe("gh CLI fallback when GITHUB_TOKEN is not set", () => {
      it("returns branches from gh pr list", async () => {
        mockSpawnAsync.mockResolvedValue({
          code: 0,
          stdout: JSON.stringify([
            {
              number: 42,
              title: "Add dark mode",
              headRefName: "feature/dark-mode",
            },
            {
              number: 15,
              title: "Fix login bug",
              headRefName: "fix/login-bug",
            },
          ]),
          stderr: "",
        });

        const result = await service.fetchBranchesWithOpenPRs(
          "myorg",
          "myrepo",
        );

        expect(result).toEqual([
          {
            branch: "feature/dark-mode",
            pr_number: 42,
            pr_title: "Add dark mode",
          },
          {
            branch: "fix/login-bug",
            pr_number: 15,
            pr_title: "Fix login bug",
          },
        ]);

        expect(mockSpawnAsync).toHaveBeenCalledWith("gh", [
          "pr",
          "list",
          "--repo",
          "myorg/myrepo",
          "--state",
          "open",
          "--json",
          "number,title,headRefName",
          "--limit",
          "100",
        ]);
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it("throws when gh CLI exits with non-zero code", async () => {
        mockSpawnAsync.mockResolvedValue({
          code: 1,
          stdout: "",
          stderr: "gh: not logged in",
        });

        await expect(
          service.fetchBranchesWithOpenPRs("myorg", "myrepo"),
        ).rejects.toThrow();
      });
    });
  });
});
