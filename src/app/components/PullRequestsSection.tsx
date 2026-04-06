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
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        ))}
      </div>
    </section>
  );
}
