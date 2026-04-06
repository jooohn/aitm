"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import RunWorkflowModal from "@/app/components/RunWorkflowModal";
import WorktreeSection from "@/app/components/WorktreeSection";
import {
  fetchRepository,
  fetchWorkflowRuns,
  type RepositoryDetail,
  type WorkflowRun,
  type WorkflowRunStatus,
} from "@/lib/utils/api";
import styles from "./RepositoryShell.module.css";

const RUN_STATUS_LABELS: Record<WorkflowRunStatus, string> = {
  running: "Running",
  success: "Success",
  failure: "Failure",
};

const runStatusDotClass: Record<WorkflowRunStatus, string> = {
  running: styles["runStatusDot-running"],
  success: styles["runStatusDot-success"],
  failure: styles["runStatusDot-failure"],
};

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
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[] | null>(null);
  const [workflowRunsError, setWorkflowRunsError] = useState<string | null>(
    null,
  );
  const [showLaunchModal, setShowLaunchModal] = useState(false);

  useEffect(() => {
    fetchRepository(organization, name)
      .then(setRepo)
      .catch(() => setRepo(null));
  }, [organization, name]);

  useEffect(() => {
    if (!repo) return;
    fetchWorkflowRuns(repo.path)
      .then(setWorkflowRuns)
      .catch((err) => {
        setWorkflowRunsError(
          err instanceof Error ? err.message : "Failed to load workflow runs",
        );
      });
  }, [repo]);

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
              <svg
                viewBox="0 0 16 16"
                width="20"
                height="20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
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
        <section className={styles.paneSection}>
          <h2 className={styles.paneHeading}>Workflow Runs</h2>
          {workflowRunsError && (
            <p className={styles.error}>{workflowRunsError}</p>
          )}
          {workflowRuns && workflowRuns.length === 0 && (
            <p className={styles.runsEmpty}>No workflow runs yet.</p>
          )}
          {workflowRuns && workflowRuns.length > 0 && (
            <ul className={styles.runsList}>
              {workflowRuns.map((run) => (
                <li key={run.id}>
                  <Link
                    href={`/repositories/${organization}/${name}/workflow-runs/${run.id}`}
                    className={styles.runItem}
                  >
                    <span
                      className={`${styles.runStatusDot} ${runStatusDotClass[run.status]}`}
                      title={RUN_STATUS_LABELS[run.status]}
                    />
                    <span className={styles.runInfo}>
                      <span className={styles.runBranch}>
                        {run.worktree_branch}
                      </span>
                      <span className={styles.runWorkflow}>
                        {run.workflow_name}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <WorktreeSection organization={organization} name={name} />
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
