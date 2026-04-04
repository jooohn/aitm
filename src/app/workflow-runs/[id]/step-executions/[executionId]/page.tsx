"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import WorkflowBreadcrumb from "@/app/components/WorkflowBreadcrumb";
import {
  fetchWorkflowRun,
  type StepExecution,
  type WorkflowRunDetail,
} from "@/lib/utils/api";
import { inferAlias } from "@/lib/utils/inferAlias";
import styles from "./page.module.css";

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

export default function StepExecutionPage() {
  const { id, executionId } = useParams<{ id: string; executionId: string }>();
  const [run, setRun] = useState<WorkflowRunDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWorkflowRun(id)
      .then(setRun)
      .catch(() => notFound())
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return null;
  if (!run) return notFound();

  const execution = run.step_executions.find((e) => e.id === executionId);
  if (!execution) return notFound();

  const repoAlias = inferAlias(run.repository_path);
  const [organization, repoName] = repoAlias.split("/");
  const decision = parseDecision(execution.transition_decision);
  const isRunning = execution.completed_at === null;

  return (
    <main className={styles.page}>
      <WorkflowBreadcrumb
        repository={{ organization, name: repoName }}
        branch={run.worktree_branch}
        workflowRun={{ id: run.id, name: run.workflow_name }}
        stepExecution={{
          id: execution.id,
          workflowRunId: run.id,
          stepName: execution.step,
        }}
      />

      <div className={styles.header}>
        <div className={styles.headerLeft}>
          {isRunning ? (
            <span className={`${styles.badge} ${styles["badge-running"]}`}>
              Running
            </span>
          ) : (
            <span className={`${styles.badge} ${styles["badge-completed"]}`}>
              Completed
            </span>
          )}
          <h1 className={styles.title}>{execution.step}</h1>
        </div>
      </div>

      <dl className={styles.details}>
        <div className={styles.detailRow}>
          <dt className={styles.detailLabel}>Type</dt>
          <dd className={styles.detailValue}>{execution.step_type}</dd>
        </div>
        <div className={styles.detailRow}>
          <dt className={styles.detailLabel}>Started</dt>
          <dd className={styles.detailValue}>
            {new Date(execution.created_at).toLocaleString()}
          </dd>
        </div>
        {execution.completed_at && (
          <div className={styles.detailRow}>
            <dt className={styles.detailLabel}>Completed</dt>
            <dd className={styles.detailValue}>
              {new Date(execution.completed_at).toLocaleString()}
            </dd>
          </div>
        )}
        {execution.session_id && (
          <div className={styles.detailRow}>
            <dt className={styles.detailLabel}>Session</dt>
            <dd className={styles.detailValue}>
              <Link
                href={`/sessions/${execution.session_id}`}
                className={styles.sessionLink}
              >
                Session {execution.session_id.slice(0, 8)}…
              </Link>
            </dd>
          </div>
        )}
      </dl>

      {execution.step_type === "command" && execution.command_output && (
        <section>
          <h2 className={styles.sectionHeading}>Command output</h2>
          <div className={styles.commandOutput}>{execution.command_output}</div>
        </section>
      )}

      {decision && (
        <section>
          <h2 className={styles.sectionHeading}>Transition</h2>
          <dl className={styles.details}>
            <div className={styles.detailRow}>
              <dt className={styles.detailLabel}>Decision</dt>
              <dd className={styles.detailValue}>{decision.transition}</dd>
            </div>
            <div className={styles.detailRow}>
              <dt className={styles.detailLabel}>Reason</dt>
              <dd className={styles.detailValue}>{decision.reason}</dd>
            </div>
            {decision.handoff_summary && (
              <div className={styles.detailRow}>
                <dt className={styles.detailLabel}>Summary</dt>
                <dd className={styles.detailValue}>
                  {decision.handoff_summary}
                </dd>
              </div>
            )}
          </dl>
        </section>
      )}
    </main>
  );
}
