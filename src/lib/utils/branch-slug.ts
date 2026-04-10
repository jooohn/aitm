export function branchToSlug(branch: string): string {
  return branch.replaceAll("/", "__");
}

export function slugToBranch(slug: string): string {
  return slug.replaceAll("__", "/");
}
