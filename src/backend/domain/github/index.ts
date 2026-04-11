import type { SpawnResult } from "@/backend/utils/process";
import type { RemoteBranchDto } from "@/shared/contracts/api";

interface GitHubPullResponse {
  number: number;
  title: string;
  head: { ref: string };
}

interface GhPrListEntry {
  number: number;
  title: string;
  headRefName: string;
}

type SpawnAsyncFn = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
) => Promise<SpawnResult>;

export class GitHubBranchService {
  constructor(private readonly spawnAsync: SpawnAsyncFn) {}

  async fetchBranchesWithOpenPRs(
    owner: string,
    repo: string,
  ): Promise<RemoteBranchDto[]> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return this.fetchViaGhCli(owner, repo);
    }

    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=100`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `GitHub API error ${res.status} ${res.statusText}: ${body}`,
      );
    }

    const pulls: GitHubPullResponse[] = await res.json();
    return pulls.map((pr) => ({
      branch: pr.head.ref,
      pr_number: pr.number,
      pr_title: pr.title,
    }));
  }

  private async fetchViaGhCli(
    owner: string,
    repo: string,
  ): Promise<RemoteBranchDto[]> {
    const result = await this.spawnAsync("gh", [
      "pr",
      "list",
      "--repo",
      `${owner}/${repo}`,
      "--state",
      "open",
      "--json",
      "number,title,headRefName",
      "--limit",
      "100",
    ]);

    if (result.code !== 0) {
      throw new Error(
        `gh pr list failed (exit ${result.code}): ${result.stderr}`,
      );
    }

    const entries: GhPrListEntry[] = JSON.parse(result.stdout);
    return entries.map((entry) => ({
      branch: entry.headRefName,
      pr_number: entry.number,
      pr_title: entry.title,
    }));
  }
}
