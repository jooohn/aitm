import { access } from "fs/promises";
import { basename, join } from "path";
import type {
  ConfigRepository,
  ConfigRepositoryCommand,
} from "@/backend/infra/config";
import { spawnAsync } from "@/backend/utils/process";

export interface Repository {
  path: string;
  name: string;
  alias: string;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

import { inferAlias } from "@/lib/utils/inferAlias";

export { inferAlias };

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isGitRepo(path: string): Promise<boolean> {
  return pathExists(join(path, ".git"));
}

export class RepositoryService {
  constructor(private configRepositories: ConfigRepository[]) {}

  async listRepositories(): Promise<Repository[]> {
    return this.configRepositories
      .map((r) => ({
        path: r.path,
        name: basename(r.path),
        alias: inferAlias(r.path),
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async getRepositoryByAlias(alias: string): Promise<Repository | undefined> {
    return (await this.listRepositories()).find((r) => r.alias === alias);
  }

  getConfigForAlias(alias: string): ConfigRepository | undefined {
    return this.configRepositories.find((r) => inferAlias(r.path) === alias);
  }

  getConfigForPath(path: string): ConfigRepository | undefined {
    return this.configRepositories.find((r) => r.path === path);
  }

  getCommandsForAlias(alias: string): ConfigRepositoryCommand[] {
    return this.getConfigForAlias(alias)?.commands ?? [];
  }

  async getGitHubUrl(repoPath: string): Promise<string | null> {
    try {
      const { code, stdout } = await spawnAsync(
        "git",
        ["config", "--get", "remote.origin.url"],
        { cwd: repoPath },
      );
      if (code !== 0) return null;

      const remoteUrl = stdout.trim();

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

  async validateRepository(path: string): Promise<ValidationResult> {
    if (!(await pathExists(path))) {
      return { valid: false, reason: "Path does not exist" };
    }
    if (!(await isGitRepo(path))) {
      return { valid: false, reason: "Path is not a git repository" };
    }
    return { valid: true };
  }
}
