"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  fetchWorkflowRun,
  resolveManualApproval,
  type StepExecution,
  type WorkflowRunDetail,
} from "@/lib/utils/api";
import { inferAlias } from "@/lib/utils/inferAlias";
import { workflowRunPath } from "@/lib/utils/workflowRunPath";
import styles from "./ApprovalDetail.module.css";

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

interface Props {
  workflowRunId: string;
}

export default function ApprovalDetail({ workflowRunId }: Props) {
  const router = useRouter();
  const [run, setRun] = useState<WorkflowRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    fetchWorkflowRun(workflowRunId)
      .then(setRun)
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Failed to load workflow run",
        ),
      )
      .finally(() => setLoading(false));
  }, [workflowRunId]);

  if (loading) return <p className={styles.status}>Loading…</p>;
  if (error) return <p className={styles.error}>{error}</p>;
  if (!run) return <p className={styles.error}>Workflow run not found.</p>;

  const pendingExecution = run.step_executions.find(
    (e) => e.step_type === "manual-approval" && e.completed_at === null,
  );

  const completedSteps = run.step_executions.filter(
    (e) => e.completed_at !== null,
  );

  async function handleResolve(decision: "approved" | "rejected") {
    setResolving(true);
    try {
      await resolveManualApproval(workflowRunId, decision, reason || undefined);
      router.push("/todos");
    } catch {
      // ignore — user can retry
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>
          {inferAlias(run.repository_path)} - {run.worktree_branch}
        </h2>
        <p className={styles.meta}>
          <span>{run.workflow_name}</span>
          {pendingExecution && (
            <>
              <span className={styles.separator}>/</span>
              <span>{pendingExecution.step}</span>
            </>
          )}
        </p>
        <Link href={workflowRunPath(run)} className={styles.runLink}>
          View full workflow run
        </Link>
      </div>

      {completedSteps.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionHeading}>Previous steps</h3>
          <ul className={styles.stepList}>
            {completedSteps.map((execution) => (
              <PreviousStep key={execution.id} execution={execution} />
            ))}
          </ul>
        </section>
      )}

      {pendingExecution && (
        <section className={styles.section}>
          <h3 className={styles.sectionHeading}>Decision</h3>
          <textarea
            className={styles.reasonInput}
            placeholder="Comment"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={resolving}
            rows={4}
          />
          <div className={styles.actions}>
            <button
              className={`${styles.actionButton} ${styles["actionButton-approve"]}`}
              onClick={() => handleResolve("approved")}
              disabled={resolving}
            >
              {resolving ? "…" : "Approve"}
            </button>
            <button
              className={`${styles.actionButton} ${styles["actionButton-reject"]}`}
              onClick={() => handleResolve("rejected")}
              disabled={resolving}
            >
              {resolving ? "…" : "Reject"}
            </button>
          </div>
        </section>
      )}

      {!pendingExecution && (
        <p className={styles.status}>
          This workflow run no longer has a pending approval.
        </p>
      )}
    </div>
  );
}

function PreviousStep({ execution }: { execution: StepExecution }) {
  const decision = parseDecision(execution.transition_decision);
  return (
    <li className={styles.step}>
      <div className={styles.stepHeader}>
        <span className={styles.stepName}>{execution.step}</span>
        {decision && (
          <span className={styles.stepTransition}>{decision.transition}</span>
        )}
      </div>
      {decision?.handoff_summary && (
        <p className={styles.stepSummary}>{decision.handoff_summary}</p>
      )}
    </li>
  );
}
