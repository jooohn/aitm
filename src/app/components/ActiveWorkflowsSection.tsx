"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchAllWorkflowRuns, type WorkflowRun } from "@/lib/utils/api";
import styles from "./ActiveWorkflowsSection.module.css";

function repoAlias(repositoryPath: string): string {
  const parts = repositoryPath.replace(/\/$/, "").split("/");
  return parts.slice(-2).join("/");
}

export default function ActiveWorkflowsSection() {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const data = await fetchAllWorkflowRuns("running");
        if (!cancelled) {
          setError(null);
          setRuns(data);
          setLoading(false);
          setTimeout(poll, 2000);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load runs");
          setLoading(false);
          setTimeout(poll, 2000);
        }
      }
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Active workflows</h2>

      {loading && <p className={styles.status}>Loading…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!loading && !error && runs.length === 0 && (
        <p className={styles.status}>No active workflows.</p>
      )}

      {!loading && !error && runs.length > 0 && (
        <ul className={styles.list}>
          {runs.map((run) => (
            <li key={run.id} className={styles.item}>
              <div className={styles.info}>
                <div className={styles.header}>
                  <span className={styles.badge}>Running</span>
                  <span className={styles.repoAlias}>
                    {repoAlias(run.repository_path)}
                  </span>
                  <Link
                    href={`/workflow-runs/${run.id}`}
                    className={styles.branchName}
                  >
                    {run.worktree_branch}
                  </Link>
                </div>
                <div className={styles.meta}>
                  <span>{run.workflow_name}</span>
                  {run.current_step && <span>· {run.current_step}</span>}
                  <span>· {new Date(run.created_at).toLocaleString()}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
