import { randomBytes } from "node:crypto";

const WORKFLOW_PREFIXES: Record<string, string> = {
  "development-flow": "feat",
  "bugfix-flow": "fix",
  "refactor-flow": "refactor",
};

const MAX_LENGTH = 50;
const SUFFIX_LENGTH = 4;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniqueSuffix(): string {
  return randomBytes(SUFFIX_LENGTH).toString("hex").slice(0, SUFFIX_LENGTH);
}

export class BranchNameService {
  generate(workflowName: string, inputs: Record<string, string>): string {
    const prefix = WORKFLOW_PREFIXES[workflowName] ?? "task";
    const suffix = uniqueSuffix();
    const firstValue = Object.values(inputs).find((v) => v.trim().length > 0);

    if (!firstValue) {
      return `${prefix}/${Date.now()}-${suffix}`;
    }

    let slug = slugify(firstValue);
    // Reserve space for "-" + suffix
    const maxSlugLength = MAX_LENGTH - prefix.length - 1 - 1 - SUFFIX_LENGTH; // prefix + "/" + slug + "-" + suffix
    if (slug.length > maxSlugLength) {
      slug = slug.slice(0, maxSlugLength).replace(/-$/, "");
    }

    return `${prefix}/${slug}-${suffix}`;
  }
}
