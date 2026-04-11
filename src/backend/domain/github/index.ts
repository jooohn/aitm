import type { RemoteBranchDto } from "@/shared/contracts/api";

interface GitHubPullResponse {
  number: number;
  title: string;
  head: { ref: string };
}

export class GitHubBranchService {
  async fetchBranchesWithOpenPRs(
    owner: string,
    repo: string,
  ): Promise<RemoteBranchDto[]> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) return [];

    try {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=100`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (!res.ok) return [];

      const pulls: GitHubPullResponse[] = await res.json();
      return pulls.map((pr) => ({
        branch: pr.head.ref,
        pr_number: pr.number,
        pr_title: pr.title,
      }));
    } catch {
      return [];
    }
  }
}
