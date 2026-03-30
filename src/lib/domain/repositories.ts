import { existsSync } from "fs";
import { basename, join } from "path";
import { getConfigRepositories } from "../infra/config";

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

export function listRepositories(): Repository[] {
  return getConfigRepositories()
    .map((r) => ({
      path: r.path,
      name: basename(r.path),
      alias: inferAlias(r.path),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function getRepositoryByAlias(alias: string): Repository | undefined {
  return listRepositories().find((r) => r.alias === alias);
}

export function validateRepository(path: string): ValidationResult {
  if (!existsSync(path)) {
    return { valid: false, reason: "Path does not exist" };
  }
  if (!isGitRepo(path)) {
    return { valid: false, reason: "Path is not a git repository" };
  }
  return { valid: true };
}
