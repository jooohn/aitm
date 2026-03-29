"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  createWorkflowRun,
  fetchWorkflowRuns,
  fetchWorkflows,
  type WorkflowDefinition,
  type WorkflowRun,
  type WorkflowRunStatus,
} from "@/lib/api";
import styles from "./WorkflowSection.module.css";

interface Props {
  repositoryPath: string;
  branch: string;
}

const STATUS_LABELS: Record<WorkflowRunStatus, string> = {
  running: "Running",
  success: "Success",
  failure: "Failure",
};

export default function WorkflowSection({ repositoryPath, branch }: Props) {
  const [workflows, setWorkflows] = useState<
    Record<string, WorkflowDefinition>
  >({});
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [wfs, wfRuns] = await Promise.all([
        fetchWorkflows(),
        fetchWorkflowRuns(repositoryPath, branch),
      ]);
      setWorkflows(wfs);
      setRuns(wfRuns);
      if (!selectedWorkflow) {
        const names = Object.keys(wfs);
        if (names.length > 0) setSelectedWorkflow(names[0]);
      }
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load workflows",
      );
    } finally {
      setLoading(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load only on mount
  useEffect(() => {
    load();
  }, []);

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedWorkflow) return;
    setStarting(true);
    setStartError(null);
    try {
      await createWorkflowRun({
        repository_path: repositoryPath,
        worktree_branch: branch,
        workflow_name: selectedWorkflow,
      });
      await load();
    } catch (err) {
      setStartError(
        err instanceof Error ? err.message : "Failed to start workflow run",
      );
    } finally {
      setStarting(false);
    }
  }

  const workflowNames = Object.keys(workflows);

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
          {runs.map((run) => (
            <li key={run.id} className={styles.item}>
              <div className={styles.info}>
                <Link
                  href={`/workflow-runs/${run.id}`}
                  className={styles.workflowName}
                >
                  {run.workflow_name}
                </Link>
                <div className={styles.meta}>
                  <span
                    className={`${styles.badge} ${styles[`badge-${run.status}`]}`}
                  >
                    {STATUS_LABELS[run.status]}
                  </span>
                  {run.current_state && (
                    <span className={styles.state}>· {run.current_state}</span>
                  )}
                  <span>· {new Date(run.created_at).toLocaleString()}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!loading && !loadError && workflowNames.length > 0 && (
        <form onSubmit={handleStart} className={styles.form}>
          <select
            className={styles.select}
            value={selectedWorkflow}
            onChange={(e) => setSelectedWorkflow(e.target.value)}
            disabled={starting}
          >
            {workflowNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className={styles.startButton}
            disabled={starting || !selectedWorkflow}
          >
            {starting ? "Starting…" : "Start workflow"}
          </button>
        </form>
      )}

      {!loading && !loadError && workflowNames.length === 0 && (
        <p className={styles.status}>
          No workflows configured. Add workflows to{" "}
          <code className={styles.code}>~/.aitm/config.yaml</code>.
        </p>
      )}

      {startError && <p className={styles.error}>{startError}</p>}
    </section>
  );
}
