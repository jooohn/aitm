"use client";

import { useEffect, useState } from "react";
import {
  fetchAllWorkflowRuns,
  fetchWorkflowRuns,
  fetchWorkflows,
  type WorkflowDefinition,
  type WorkflowRun,
} from "@/lib/utils/api";
import { getOrderedSteps } from "@/lib/utils/workflowStepOrder";
import KanbanCard from "./KanbanCard";
import styles from "./WorkflowKanbanBoard.module.css";

interface Props {
  repositoryPath?: string;
  activeWorktreeBranches: string[] | null;
  refreshKey?: number;
}

const TERMINAL_COLUMNS = ["Success"] as const;

export default function WorkflowKanbanBoard({
  repositoryPath,
  activeWorktreeBranches,
  refreshKey,
}: Props) {
  const [workflows, setWorkflows] = useState<Record<
    string,
    WorkflowDefinition
  > | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const multiRepo = !repositoryPath;

  useEffect(() => {
    let cancelled = false;

    if (refreshKey !== undefined) {
      setLoading(true);
    }

    async function load() {
      setLoadError(null);
      try {
        const [wfDefs, wfRuns] = await Promise.all([
          fetchWorkflows(),
          repositoryPath
            ? fetchWorkflowRuns(repositoryPath)
            : fetchAllWorkflowRuns(),
        ]);
        if (cancelled) return;
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
        if (cancelled) return;
        setLoadError(
          err instanceof Error ? err.message : "Failed to load kanban data",
        );
      } finally {
        if (cancelled) return;
        setHasLoadedOnce(true);
        setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [repositoryPath, activeWorktreeBranches, refreshKey]);

  useEffect(() => {
    if (!runs.some((r) => r.status === "running")) return;

    const id = setInterval(() => {
      void (async () => {
        setLoadError(null);
        try {
          const [wfDefs, wfRuns] = await Promise.all([
            fetchWorkflows(),
            repositoryPath
              ? fetchWorkflowRuns(repositoryPath)
              : fetchAllWorkflowRuns(),
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
          setHasLoadedOnce(true);
          setLoading(false);
        }
      })();
    }, 2000);

    return () => clearInterval(id);
  }, [runs, repositoryPath, activeWorktreeBranches]);

  if (!hasLoadedOnce && loading) {
    return <p className={styles.status}>Loading…</p>;
  }
  if (loadError) return <p className={styles.error}>{loadError}</p>;
  if (!workflows) return null;

  if (runs.length === 0) {
    return (
      <section className={styles.section}>
        <h2 className={styles.heading}>Workflow Runs</h2>
        <p className={styles.status}>No workflow runs yet.</p>
      </section>
    );
  }

  const runsByWorkflow = new Map<string, WorkflowRun[]>();
  for (const run of runs) {
    const list = runsByWorkflow.get(run.workflow_name) ?? [];
    list.push(run);
    runsByWorkflow.set(run.workflow_name, list);
  }

  const configOrder = Object.keys(workflows);
  const workflowNames = [...runsByWorkflow.keys()].sort((a, b) => {
    const ai = configOrder.indexOf(a);
    const bi = configOrder.indexOf(b);
    return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
  });

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Workflow Runs</h2>
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
          } else {
            col = run.current_step ?? steps[0];
          }
          runsByColumn.get(col)?.push(run);
        }

        return (
          <div key={wfName}>
            <h3 className={styles.workflowHeading}>{wfName}</h3>
            <div className={styles.boardScroll}>
              <div className={styles.board} role="table">
                {columns.map((col) => (
                  <div key={col} className={styles.column} data-column={col}>
                    <div role="columnheader" className={styles.columnHeader}>
                      {col}
                    </div>
                    <div className={styles.columnCards}>
                      {(runsByColumn.get(col) ?? []).map((run) => (
                        <KanbanCard
                          key={run.id}
                          run={run}
                          showRepo={multiRepo}
                        />
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
