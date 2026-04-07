"use client";

import Link from "next/link";
import { useState } from "react";
import GitHubIcon from "@/app/components/icons/GitHubIcon";
import { useRepository, useWorkflowRuns, useWorktrees } from "@/lib/hooks/swr";
import styles from "./RepositoryShell.module.css";
import WorktreeRunsSection from "./WorktreeRunsSection";
import RunWorkflowModal from "./workflow-runs/RunWorkflowModal";

interface Props {
  organization: string;
  name: string;
  children: React.ReactNode;
}

export default function RepositoryShell({
  organization,
  name,
  children,
}: Props) {
  const alias = `${organization}/${name}`;
  const [showLaunchModal, setShowLaunchModal] = useState(false);

  const { data: repo } = useRepository(organization, name);
  const {
    data: worktrees,
    error: worktreesError,
    isLoading: worktreesLoading,
  } = useWorktrees(organization, name);
  const {
    data: runs,
    error: runsError,
    isLoading: runsLoading,
  } = useWorkflowRuns(repo?.path ?? null);

  const dataLoading = worktreesLoading || runsLoading;
  const dataHasLoadedOnce =
    !!worktrees || !!worktreesError || !!runs || !!runsError;
  const dataError = worktreesError || runsError;
  const dataErrorMessage = dataError
    ? dataError instanceof Error
      ? dataError.message
      : "Failed to load data"
    : null;

  return (
    <div className={styles.shell}>
      <aside className={styles.leftPane}>
        <div className={styles.headingRow}>
          <h1 className={styles.heading}>
            <Link
              href={`/repositories/${organization}/${name}`}
              className={styles.headingLink}
            >
              {alias}
            </Link>
          </h1>
          {repo?.github_url && (
            <a
              href={repo.github_url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.githubLink}
              aria-label="Open on GitHub"
            >
              <GitHubIcon />
            </a>
          )}
        </div>
        <section className={styles.paneSection}>
          <button
            type="button"
            className={styles.launchButton}
            onClick={() => setShowLaunchModal(true)}
          >
            Run Workflow
          </button>
        </section>
        {repo && (
          <WorktreeRunsSection
            organization={organization}
            name={name}
            worktrees={worktrees ?? []}
            runs={runs ?? []}
            loading={dataLoading}
            hasLoadedOnce={dataHasLoadedOnce}
            error={dataErrorMessage}
          />
        )}
      </aside>
      <div className={styles.content}>{children}</div>
      {showLaunchModal && (
        <RunWorkflowModal
          onClose={() => setShowLaunchModal(false)}
          fixedAlias={alias}
        />
      )}
    </div>
  );
}
