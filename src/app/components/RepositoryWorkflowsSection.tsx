"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  fetchWorkflowRuns,
  type WorkflowRun,
  type WorkflowRunStatus,
} from "@/lib/utils/api";
import { extractPullRequestUrl } from "@/lib/utils/extractPullRequestUrl";
import styles from "./RepositoryWorkflowsSection.module.css";

interface Props {
  repositoryPath: string;
  activeWorktreeBranches: string[] | null;
}

const STATUS_LABELS: Record<WorkflowRunStatus, string> = {
  running: "Running",
  success: "Success",
  failure: "Failure",
};

export default function RepositoryWorkflowsSection({
  repositoryPath,
  activeWorktreeBranches,
}: Props) {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoadError(null);
    try {
      const wfRuns = await fetchWorkflowRuns(repositoryPath);
      const branchSet = activeWorktreeBranches
        ? new Set(activeWorktreeBranches)
        : null;
      setRuns(
        branchSet
          ? wfRuns.filter((r) => branchSet.has(r.worktree_branch))
          : wfRuns,
      );
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load workflow runs",
      );
    } finally {
      setLoading(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load only on mount
  useEffect(() => {
    load();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: load is stable; intentionally omitted
  useEffect(() => {
    if (!runs.some((r) => r.status === "running")) return;
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [runs]);

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Workflow runs</h2>

      {loading && <p className={styles.status}>Loading…</p>}
      {loadError && <p className={styles.error}>{loadError}</p>}

      {!loading && !loadError && (
        <ul className={styles.list}>
          {runs.length === 0 && (
            <li className={styles.status}>No workflow runs yet.</li>
          )}
          {runs.map((run) => {
            const prUrl = extractPullRequestUrl(run.metadata);
            return (
              <li key={run.id} className={styles.item}>
                <div className={styles.info}>
                  <div className={styles.header}>
                    <span
                      className={`${styles.badge} ${styles[`badge-${run.status}`]}`}
                    >
                      {STATUS_LABELS[run.status]}
                    </span>
                    <Link
                      href={`/workflow-runs/${run.id}`}
                      className={styles.branch}
                    >
                      {run.worktree_branch}
                    </Link>
                  </div>
                  <div className={styles.meta}>
                    <span className={styles.workflowName}>
                      {run.workflow_name}
                    </span>
                    {run.current_step && (
                      <span className={styles.state}>· {run.current_step}</span>
                    )}
                    <span>· {new Date(run.created_at).toLocaleString()}</span>
                    {prUrl && (
                      <a
                        href={prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.prLink}
                      >
                        · PR
                      </a>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
