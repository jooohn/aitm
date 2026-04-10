import { appendFile, mkdir, readFile, stat } from "fs/promises";
import { join, resolve } from "path";

export async function resolveGitDir(worktreePath: string): Promise<string> {
  const dotGitPath = join(worktreePath, ".git");
  const dotGitStat = await stat(dotGitPath);

  if (dotGitStat.isDirectory()) {
    return dotGitPath;
  }

  const content = await readFile(dotGitPath, "utf8");
  const match = content.match(/^gitdir:\s*(.+)\s*$/m);
  if (!match) {
    throw new Error(`Failed to parse gitdir from ${dotGitPath}`);
  }

  return resolve(worktreePath, match[1]);
}

export async function resolveGitInfoDir(worktreePath: string): Promise<string> {
  const gitDir = await resolveGitDir(worktreePath);
  const commonDirPath = join(gitDir, "commondir");
  const commonDir = await readFile(commonDirPath, "utf8")
    .then((content) => content.trim())
    .catch(() => null);

  return commonDir
    ? join(resolve(gitDir, commonDir), "info")
    : join(gitDir, "info");
}

export async function ensureExcludeEntry(
  infoDir: string,
  excludeEntry: string,
): Promise<void> {
  const excludePath = join(infoDir, "exclude");
  await mkdir(infoDir, { recursive: true });

  const existing = await readFile(excludePath, "utf8").catch(() => "");
  const lines = existing.split(/\r?\n/).filter(Boolean);
  if (!lines.includes(excludeEntry)) {
    const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
    await appendFile(excludePath, `${prefix}${excludeEntry}\n`, "utf8");
  }
}
