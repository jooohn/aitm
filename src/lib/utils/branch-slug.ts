export function branchToSlug(branch: string): string {
  return branch.replaceAll("/", "__");
}
