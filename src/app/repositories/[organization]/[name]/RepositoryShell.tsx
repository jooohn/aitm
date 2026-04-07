"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import GitHubIcon from "@/app/components/icons/GitHubIcon";
import { useNotificationStream } from "@/lib/hooks/useNotificationStream";
import {
  fetchRepository,
  fetchWorkflowRuns,
  fetchWorktrees,
  type RepositoryDetail,
  type WorkflowRun,
  type Worktree,
} from "@/lib/utils/api";
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
  const [repo, setRepo] = useState<RepositoryDetail | null>(null);
  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataHasLoadedOnce, setDataHasLoadedOnce] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const loadWorktreeData = useCallback(
    async (repositoryPath: string) => {
      setDataLoading(true);
      setDataError(null);
      try {
        const [wt, wr] = await Promise.all([
          fetchWorktrees(organization, name),
          fetchWorkflowRuns(repositoryPath),
        ]);
        setWorktrees(wt);
        setRuns(wr);
      } catch (err) {
        setDataError(
          err instanceof Error ? err.message : "Failed to load data",
        );
      } finally {
        setDataHasLoadedOnce(true);
        setDataLoading(false);
      }
    },
    [organization, name],
  );

  useEffect(() => {
    fetchRepository(organization, name)
      .then(async (repo) => {
        await loadWorktreeData(repo.path);
        setRepo(repo);
      })
      .catch(() => setRepo(null));
  }, [organization, name, loadWorktreeData]);

  useNotificationStream(() => {
    if (repo) {
      loadWorktreeData(repo.path);
    }
  });

  const handleReload = useCallback(() => {
    if (repo) {
      loadWorktreeData(repo.path);
    }
  }, [repo, loadWorktreeData]);

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
            worktrees={worktrees}
            runs={runs}
            loading={dataLoading}
            hasLoadedOnce={dataHasLoadedOnce}
            error={dataError}
            onReload={handleReload}
          />
        )}
      </aside>
      <div className={styles.content}>{children}</div>
      {showLaunchModal && (
        <RunWorkflowModal
          onClose={() => setShowLaunchModal(false)}
          fixedAlias={alias}
          onCreated={handleReload}
        />
      )}
    </div>
  );
}
