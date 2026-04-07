"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import type { StatusBadgeVariant } from "@/app/components/StatusBadge";
import StatusBadge from "@/app/components/StatusBadge";
import { useWorkflowRun } from "@/lib/hooks/swr";
import { isNotFoundError } from "@/lib/utils/api";
import WorkflowBreadcrumb from "../../WorkflowBreadcrumb";
import styles from "./page.module.css";

const STEP_EXECUTION_BADGE: Record<
  "running" | "completed",
  { variant: StatusBadgeVariant; label: string }
> = {
  running: { variant: "running", label: "Running" },
  completed: { variant: "success", label: "Completed" },
};

export default function StepExecutionPage() {
  const { id, executionId, organization, name } = useParams<{
    id: string;
    executionId: string;
    organization: string;
    name: string;
  }>();
  const { data: run, error, isLoading: loading } = useWorkflowRun(id);

  if (!run && loading) return null;
  if (isNotFoundError(error)) return notFound();
  if (error) {
    return (
      <main className={styles.page}>
        <p className={styles.error}>
          {error instanceof Error
            ? error.message
            : "Failed to load workflow run"}
        </p>
      </main>
    );
  }
  if (!run) return null;

  const execution = run.step_executions.find((e) => e.id === executionId);
  if (!execution) return notFound();

  const decision = execution.transition_decision;
  const badge =
    STEP_EXECUTION_BADGE[
      execution.completed_at === null ? "running" : "completed"
    ];

  return (
    <main className={styles.page}>
      <WorkflowBreadcrumb
        repository={{ organization, name }}
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
          <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge>
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
                href={`/repositories/${organization}/${name}/workflow-runs/${id}/sessions/${execution.session_id}`}
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
