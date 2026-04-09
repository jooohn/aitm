export function inferAlias(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}

export function splitAlias(repositoryPath: string): {
  organization: string;
  name: string;
} {
  const alias = inferAlias(repositoryPath);
  const [organization, name] = alias.split("/");
  return { organization, name };
}
