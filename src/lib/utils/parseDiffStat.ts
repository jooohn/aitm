export interface DiffStat {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

/**
 * Parse the summary line from `git diff --stat` output.
 * Example: " 3 files changed, 15 insertions(+), 7 deletions(-)"
 */
export function parseDiffStat(stat: string): DiffStat | null {
  const lines = stat.trim().split("\n");
  const summary = lines.at(-1);
  if (!summary) return null;

  const filesMatch = summary.match(/(\d+)\s+files?\s+changed/);
  const insertionsMatch = summary.match(/(\d+)\s+insertions?\(\+\)/);
  const deletionsMatch = summary.match(/(\d+)\s+deletions?\(-\)/);

  if (!filesMatch && !insertionsMatch && !deletionsMatch) return null;

  return {
    filesChanged: filesMatch ? Number(filesMatch[1]) : 0,
    insertions: insertionsMatch ? Number(insertionsMatch[1]) : 0,
    deletions: deletionsMatch ? Number(deletionsMatch[1]) : 0,
  };
}
