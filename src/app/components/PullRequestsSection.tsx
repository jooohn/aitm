import type { WorkflowRun } from "@/lib/utils/api";
import { extractPullRequestUrl } from "@/lib/utils/extractPullRequestUrl";
import styles from "./PullRequestsSection.module.css";

const prPattern = /([^/]+\/[^/]+)\/pull\/(\d+)/;

function parsePrLabel(url: string): string | null {
  const match = url.match(prPattern);
  if (!match) return null;
  return `${match[1]}#${match[2]}`;
}

interface Props {
  workflowRuns: WorkflowRun[];
}

export default function PullRequestsSection({ workflowRuns }: Props) {
  const uniqueUrls = [
    ...new Set(
      workflowRuns
        .map((run) => extractPullRequestUrl(run.metadata))
        .filter((url): url is string => url !== null),
    ),
  ];

  if (uniqueUrls.length === 0) return null;

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Pull Requests</h2>
      <div className={styles.list}>
        {uniqueUrls.map((url) => (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.link}
          >
            {parsePrLabel(url) ?? url}
          </a>
        ))}
      </div>
    </section>
  );
}
