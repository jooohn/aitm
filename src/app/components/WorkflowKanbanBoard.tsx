"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  fetchWorkflowRuns,
  fetchWorkflows,
  type WorkflowDefinition,
  type WorkflowRun,
  type WorkflowRunStatus,
} from "@/lib/utils/api";
import { getOrderedSteps } from "@/lib/utils/workflowStepOrder";
import styles from "./WorkflowKanbanBoard.module.css";

interface Props {
  repositoryPath: string;
  activeWorktreeBranches: string[] | null;
}

const STATUS_LABELS: Record<WorkflowRunStatus, string> = {
  running: "Running",
  success: "Success",
  failure: "Failure",
};

const TERMINAL_COLUMNS = ["Success", "Failure"] as const;

export default function WorkflowKanbanBoard({
  repositoryPath,
  activeWorktreeBranches,
}: Props) {
  const [workflows, setWorkflows] = useState<Record<
    string,
    WorkflowDefinition
  > | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoadError(null);
    try {
      const [wfDefs, wfRuns] = await Promise.all([
        fetchWorkflows(),
        fetchWorkflowRuns(repositoryPath),
      ]);
      setWorkflows(wfDefs);
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
        err instanceof Error ? err.message : "Failed to load kanban data",
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

  if (loading) return <p className={styles.status}>Loading…</p>;
  if (loadError) return <p className={styles.error}>{loadError}</p>;
  if (!workflows || runs.length === 0) return null;

  const runsByWorkflow = new Map<string, WorkflowRun[]>();
  for (const run of runs) {
    const list = runsByWorkflow.get(run.workflow_name) ?? [];
    list.push(run);
    runsByWorkflow.set(run.workflow_name, list);
  }

  const workflowNames = [...runsByWorkflow.keys()];

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Kanban</h2>
      {workflowNames.map((wfName) => {
        const definition = workflows[wfName];
        if (!definition) return null;

        const steps = getOrderedSteps(definition);
        const columns = [...steps, ...TERMINAL_COLUMNS];
        const wfRuns = runsByWorkflow.get(wfName) ?? [];

        const runsByColumn = new Map<string, WorkflowRun[]>();
        for (const col of columns) {
          runsByColumn.set(col, []);
        }

        for (const run of wfRuns) {
          let col: string;
          if (run.status === "success" && !run.current_step) {
            col = "Success";
          } else if (run.status === "failure" && !run.current_step) {
            col = "Failure";
          } else {
            col = run.current_step ?? steps[0];
          }
          runsByColumn.get(col)?.push(run);
        }

        return (
          <div key={wfName}>
            {workflowNames.length > 1 && (
              <h3 className={styles.workflowHeading}>{wfName}</h3>
            )}
            <div className={styles.boardScroll}>
              <div className={styles.board} role="table">
                {columns.map((col) => (
                  <div key={col} className={styles.column} data-column={col}>
                    <div role="columnheader" className={styles.columnHeader}>
                      {col}
                    </div>
                    <div className={styles.columnCards}>
                      {(runsByColumn.get(col) ?? []).map((run) => (
                        <div key={run.id} className={styles.card} role="row">
                          <Link
                            href={`/workflow-runs/${run.id}`}
                            className={styles.cardBranch}
                          >
                            {run.worktree_branch}
                          </Link>
                          <div className={styles.cardMeta}>
                            <span
                              className={`${styles.badge} ${styles[`badge-${run.status}`]}`}
                            >
                              {STATUS_LABELS[run.status]}
                            </span>
                            <span>{timeAgo(run.created_at)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
