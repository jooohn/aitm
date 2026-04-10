import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubBranchService } from ".";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.GITHUB_TOKEN;
});

describe("GitHubBranchService", () => {
  const service = new GitHubBranchService();

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

    it("returns empty array when GITHUB_TOKEN is not set", async () => {
      const result = await service.fetchBranchesWithOpenPRs("myorg", "myrepo");

      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns empty array when GitHub API returns an error", async () => {
      process.env.GITHUB_TOKEN = "ghp_test123";
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      });

      const result = await service.fetchBranchesWithOpenPRs("myorg", "myrepo");

      expect(result).toEqual([]);
    });

    it("returns empty array when fetch throws", async () => {
      process.env.GITHUB_TOKEN = "ghp_test123";
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await service.fetchBranchesWithOpenPRs("myorg", "myrepo");

      expect(result).toEqual([]);
    });
  });
});
