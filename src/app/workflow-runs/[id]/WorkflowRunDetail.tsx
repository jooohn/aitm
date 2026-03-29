"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  fetchWorkflowRun,
  type StateExecution,
  type WorkflowRunDetail,
  type WorkflowRunStatus,
} from "@/lib/api";
import styles from "./WorkflowRunDetail.module.css";

interface Props {
  run: WorkflowRunDetail;
}

const STATUS_LABELS: Record<WorkflowRunStatus, string> = {
  running: "Running",
  success: "Success",
  failure: "Failure",
};

const TERMINAL_STATUSES: WorkflowRunStatus[] = ["success", "failure"];

interface TransitionDecision {
  transition: string;
  reason: string;
  handoff_summary: string;
}

function parseDecision(raw: string | null): TransitionDecision | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TransitionDecision;
  } catch {
    return null;
  }
}

function StateExecutionItem({ execution }: { execution: StateExecution }) {
  const decision = parseDecision(execution.transition_decision);
  const isRunning = execution.completed_at === null;

  return (
    <li className={styles.execution}>
      <div className={styles.executionHeader}>
        <span className={styles.stateName}>{execution.state}</span>
        {isRunning ? (
          <span className={`${styles.badge} ${styles["badge-running"]}`}>
            Running
          </span>
        ) : (
          <span className={`${styles.badge} ${styles["badge-completed"]}`}>
            Completed
          </span>
        )}
      </div>
      <div className={styles.executionMeta}>
        <Link
          href={`/sessions/${execution.session_id}`}
          className={styles.sessionLink}
        >
          Session {execution.session_id.slice(0, 8)}…
        </Link>
        <span className={styles.timestamp}>
          {new Date(execution.created_at).toLocaleString()}
        </span>
      </div>
      {decision && (
        <div className={styles.decision}>
          <div className={styles.decisionTransition}>
            <span className={styles.decisionLabel}>Transition</span>
            <span
              className={`${styles.transitionTarget} ${
                decision.transition === "success"
                  ? styles["transition-success"]
                  : decision.transition === "failure"
                    ? styles["transition-failure"]
                    : styles["transition-state"]
              }`}
            >
              {decision.transition}
            </span>
          </div>
          <div className={styles.decisionRow}>
            <span className={styles.decisionLabel}>Reason</span>
            <span className={styles.decisionValue}>{decision.reason}</span>
          </div>
          {decision.handoff_summary && (
            <div className={styles.decisionRow}>
              <span className={styles.decisionLabel}>Summary</span>
              <span className={styles.decisionValue}>
                {decision.handoff_summary}
              </span>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function WorkflowRunDetail({ run: initial }: Props) {
  const [run, setRun] = useState<WorkflowRunDetail>(initial);

  const isTerminal = TERMINAL_STATUSES.includes(run.status);

  useEffect(() => {
    if (isTerminal) return;

    const interval = setInterval(async () => {
      try {
        const updated = await fetchWorkflowRun(run.id);
        setRun(updated);
        if (TERMINAL_STATUSES.includes(updated.status)) {
          clearInterval(interval);
        }
      } catch {
        // ignore poll errors
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [run.id, isTerminal]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={`${styles.badge} ${styles[`badge-${run.status}`]}`}>
            {STATUS_LABELS[run.status]}
          </span>
          <h1 className={styles.title}>{run.workflow_name}</h1>
        </div>
      </div>

      <dl className={styles.details}>
        <div className={styles.detailRow}>
          <dt className={styles.detailLabel}>Repository</dt>
          <dd className={styles.detailValue}>{run.repository_path}</dd>
        </div>
        <div className={styles.detailRow}>
          <dt className={styles.detailLabel}>Branch</dt>
          <dd className={styles.detailValue}>{run.worktree_branch}</dd>
        </div>
        {run.current_state && (
          <div className={styles.detailRow}>
            <dt className={styles.detailLabel}>Current state</dt>
            <dd className={styles.detailValue}>{run.current_state}</dd>
          </div>
        )}
        <div className={styles.detailRow}>
          <dt className={styles.detailLabel}>Started</dt>
          <dd className={styles.detailValue}>
            {new Date(run.created_at).toLocaleString()}
          </dd>
        </div>
      </dl>

      <section>
        <h2 className={styles.sectionHeading}>State executions</h2>
        {run.state_executions.length === 0 ? (
          <p className={styles.empty}>No state executions yet.</p>
        ) : (
          <ul className={styles.executions}>
            {run.state_executions.map((execution) => (
              <StateExecutionItem key={execution.id} execution={execution} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
