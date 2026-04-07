export function extractPullRequestUrl(
  metadata: Record<string, string> | null,
): string | null {
  const url = metadata?.presets__pull_request_url;
  if (typeof url !== "string") return null;
  if (!url.startsWith("https://") && !url.startsWith("http://")) return null;
  return url;
}
