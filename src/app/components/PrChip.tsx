import type { WorkflowRun } from "@/lib/utils/api";
import { extractPullRequestUrl } from "@/lib/utils/extractPullRequestUrl";
import styles from "./PrChip.module.css";

const prPattern = /([^/]+\/[^/]+)\/pull\/(\d+)/;

export interface PrInfo {
  number: string;
  label: string;
  url: string;
}

export function extractPrInfos(runs: WorkflowRun[]): PrInfo[] {
  const seen = new Set<string>();
  const result: PrInfo[] = [];
  for (const run of runs) {
    const url = extractPullRequestUrl(run.metadata);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const match = url.match(prPattern);
    if (match) {
      result.push({ number: match[2], label: `${match[1]}#${match[2]}`, url });
    }
  }
  return result;
}

interface Props {
  pr: PrInfo;
  variant?: "compact" | "full";
}

export default function PrChip({ pr, variant = "compact" }: Props) {
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.chip}
    >
      {variant === "compact" ? `#${pr.number}` : pr.label}
    </a>
  );
}
