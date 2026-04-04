export function extractPullRequestUrl(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    const url = parsed?.presets__pull_request_url;
    if (typeof url !== "string") return null;
    if (!url.startsWith("https://") && !url.startsWith("http://")) return null;
    return url;
  } catch {
    return null;
  }
}
