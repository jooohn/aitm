import ExternalLinkIcon from "@/app/components/icons/ExternalLinkIcon";
import type { PrInfo } from "@/app/components/PrChip";
import styles from "./WorktreePullRequests.module.css";

interface Props {
  prs: PrInfo[];
}

export default function WorktreePullRequests({ prs }: Props) {
  if (prs.length === 0) return null;

  return (
    <>
      <ul className={styles.list}>
        {prs.map((pr) => (
          <li key={pr.url}>
            <a
              href={pr.url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.item}
            >
              <span className={styles.iconWrap}>
                <PullRequestIcon />
              </span>
              <span className={styles.label}>PR #{pr.number}</span>
              <ExternalLinkIcon size={12} className={styles.external} />
            </a>
          </li>
        ))}
      </ul>
      <div className={styles.divider} />
    </>
  );
}

function PullRequestIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 16 16"
      fill="currentColor"
      className={styles.icon}
      aria-hidden="true"
    >
      <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
    </svg>
  );
}
