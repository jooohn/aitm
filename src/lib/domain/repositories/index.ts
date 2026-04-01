import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { basename, join } from "path";
import { getConfigRepositories } from "../../infra/config";

export interface Repository {
  path: string;
  name: string;
  alias: string;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export function inferAlias(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}

function isGitRepo(path: string): boolean {
  return existsSync(join(path, ".git"));
}

export class RepositoryService {
  listRepositories(): Repository[] {
    return getConfigRepositories()
      .map((r) => ({
        path: r.path,
        name: basename(r.path),
        alias: inferAlias(r.path),
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  getRepositoryByAlias(alias: string): Repository | undefined {
    return this.listRepositories().find((r) => r.alias === alias);
  }

  getGitHubUrl(repoPath: string): string | null {
    try {
      const remoteUrl = execFileSync(
        "git",
        ["config", "--get", "remote.origin.url"],
        { cwd: repoPath, encoding: "utf8" },
      ).trim();

      const sshMatch = remoteUrl.match(/^git@github\.com:(.+?)(?:\.git)?$/);
      if (sshMatch) return `https://github.com/${sshMatch[1]}`;

      const httpsMatch = remoteUrl.match(
        /^https?:\/\/(?:[^@]+@)?github\.com\/(.+?)(?:\.git)?$/,
      );
      if (httpsMatch) return `https://github.com/${httpsMatch[1]}`;

      const sshUrlMatch = remoteUrl.match(
        /^ssh:\/\/(?:[^@]+@)?github\.com\/(.+?)(?:\.git)?$/,
      );
      if (sshUrlMatch) return `https://github.com/${sshUrlMatch[1]}`;

      return null;
    } catch {
      return null;
    }
  }

  validateRepository(path: string): ValidationResult {
    if (!existsSync(path)) {
      return { valid: false, reason: "Path does not exist" };
    }
    if (!isGitRepo(path)) {
      return { valid: false, reason: "Path is not a git repository" };
    }
    return { valid: true };
  }
}
