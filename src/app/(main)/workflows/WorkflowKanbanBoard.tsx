"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { swrKeys } from "@/lib/hooks/swr";
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
  organization?: string;
  name?: string;
  activeWorktreeBranches: string[] | null;
}

const TERMINAL_COLUMNS = ["Success"] as const;

export default function WorkflowKanbanBoard({
  organization,
  name,
  activeWorktreeBranches,
}: Props) {
  const multiRepo = !organization || !name;

  const { data: workflows } = useSWR<Record<string, WorkflowDefinition>>(
    swrKeys.workflows(),
    fetchWorkflows,
  );

  const {
    data: rawRuns,
    error: loadError,
    isLoading,
  } = useSWR<WorkflowRun[]>(
    organization && name
      ? swrKeys.workflowRuns({ organization, name })
      : swrKeys.workflowRuns(),
    () =>
      organization && name
        ? fetchWorkflowRuns(organization, name)
        : fetchAllWorkflowRuns(),
    {
      refreshInterval: (data) =>
        data?.some((r) => r.status === "running") ? 2000 : 0,
    },
  );

  const runs = useMemo(() => {
    if (!rawRuns) return [];
    if (!activeWorktreeBranches) return rawRuns;
    const branchSet = new Set(activeWorktreeBranches);
    return rawRuns.filter((r) => branchSet.has(r.worktree_branch));
  }, [rawRuns, activeWorktreeBranches]);

  const hasLoadedOnce = !!rawRuns || !!loadError;
  const loading = isLoading;

  if (!hasLoadedOnce && loading) {
    return <p className={styles.status}>Loading…</p>;
  }
  if (loadError) {
    return (
      <p className={styles.error}>
        {loadError instanceof Error
          ? loadError.message
          : "Failed to load kanban data"}
      </p>
    );
  }
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
            <h3 className={styles.workflowHeading}>
              {definition.label ?? wfName}
            </h3>
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
