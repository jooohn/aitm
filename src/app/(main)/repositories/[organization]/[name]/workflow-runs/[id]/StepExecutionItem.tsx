"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import StatusBadge, {
  type StatusBadgeVariant,
} from "@/app/components/StatusBadge";
import { fetchWorkflowRunDiff, type StepExecution } from "@/lib/utils/api";
import { type DiffStat, parseDiffStat } from "@/lib/utils/parseDiffStat";
import type { TransitionDecisionDto } from "@/shared/contracts/api";
import styles from "./WorkflowRunDetail.module.css";

const STATUS_LABELS: Record<StepExecution["status"], string> = {
  awaiting: "Awaiting",
  running: "Running",
  success: "Success",
  failure: "Failure",
};

function getStatusDisplay(execution: StepExecution): {
  label: string;
  variant: StatusBadgeVariant;
} {
  if (execution.status === "success") {
    const transition = execution.transition_decision?.transition;
    if (transition === "success" || transition === "failure") {
      // Terminal execution — keep original status styling
      return {
        label: transition === "success" ? "Successful" : STATUS_LABELS.success,
        variant: "success",
      };
    }
    // Non-terminal: completed, neutral styling
    return { label: "Completed", variant: "completed" };
  }
  return { label: STATUS_LABELS[execution.status], variant: execution.status };
}

interface StepExecutionItemProps {
  execution: StepExecution;
  isCurrent: boolean;
  runBasePath: string;
  runId: string;
  onResolve?: (
    executionId: string,
    decision: "approved" | "rejected",
    reason: string,
  ) => void;
  resolvingId?: string | null;
}

function getOutputFilename(outputFilePath: string): string {
  const parts = outputFilePath.split(/[/\\]/);
  return parts.at(-1) ?? outputFilePath;
}

export default function StepExecutionItem({
  execution,
  isCurrent,
  runBasePath,
  runId,
  onResolve,
  resolvingId,
}: StepExecutionItemProps) {
  const [approvalReason, setApprovalReason] = useState("");
  const [diffStat, setDiffStat] = useState<DiffStat | null>(null);
  const { label: statusLabel, variant: statusVariant } =
    getStatusDisplay(execution);
  const decision: TransitionDecisionDto | null = execution.transition_decision;
  const outputFilename = execution.output_file_path
    ? getOutputFilename(execution.output_file_path)
    : null;
  const commandOutputHref = outputFilename
    ? `${runBasePath}/command-outputs/${encodeURIComponent(outputFilename)}`
    : null;
  const isPendingApproval =
    execution.step_type === "manual-approval" &&
    execution.status === "awaiting";

  // biome-ignore lint/correctness/useExhaustiveDependencies: onResolve is an unstable reference from the parent; including it causes repeated fetches
  useEffect(() => {
    if (!isPendingApproval || !onResolve) return;
    let cancelled = false;
    fetchWorkflowRunDiff(runId)
      .then((res) => {
        if (!cancelled) setDiffStat(parseDiffStat(res.stat));
      })
      .catch(() => {
        // Diff stats are best-effort; silently ignore errors
      });
    return () => {
      cancelled = true;
    };
  }, [isPendingApproval, runId]);

  return (
    <li
      id={`step-execution-${execution.id}`}
      className={`${styles.execution} ${isCurrent ? (styles[`execution-${execution.status}`] ?? "") : ""}`}
      data-status={execution.status}
    >
      <div className={styles.executionHeader}>
        <span className={styles.stateName}>{execution.step}</span>
        <StatusBadge variant={statusVariant}>{statusLabel}</StatusBadge>
      </div>
      <div className={styles.executionMeta}>
        {execution.session_id && (
          <Link
            href={`${runBasePath}/sessions/${execution.session_id}`}
            className={styles.sessionLink}
          >
            Session {execution.session_id.slice(0, 8)}…
          </Link>
        )}
        {commandOutputHref && outputFilename && (
          <Link href={commandOutputHref} className={styles.sessionLink}>
            Output {outputFilename}
          </Link>
        )}
        <span className={styles.timestamp}>
          {new Date(execution.created_at).toLocaleString()}
        </span>
      </div>
      {isPendingApproval && onResolve && (
        <div className={styles.approvalSection}>
          {diffStat && (
            <div className={styles.diffStats}>
              <span>
                {diffStat.filesChanged} file
                {diffStat.filesChanged !== 1 ? "s" : ""} changed
              </span>
              {diffStat.insertions > 0 && (
                <span className={styles.diffStatsInsertion}>
                  +{diffStat.insertions}
                </span>
              )}
              {diffStat.deletions > 0 && (
                <span className={styles.diffStatsDeletion}>
                  −{diffStat.deletions}
                </span>
              )}
              <Link
                href={`${runBasePath}/changes`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.viewChangesLink}
              >
                View Changes
              </Link>
            </div>
          )}
          <textarea
            className={styles.approvalReason}
            placeholder="Comment"
            value={approvalReason}
            onChange={(e) => setApprovalReason(e.target.value)}
            disabled={resolvingId === execution.id}
            rows={3}
          />
          <div className={styles.approvalActions}>
            <button
              className={`${styles.approvalButton} ${styles["approvalButton-approve"]}`}
              onClick={() =>
                onResolve(execution.id, "approved", approvalReason)
              }
              disabled={resolvingId === execution.id}
            >
              {resolvingId === execution.id ? "…" : "Approve"}
            </button>
            <button
              className={`${styles.approvalButton} ${styles["approvalButton-reject"]}`}
              onClick={() =>
                onResolve(execution.id, "rejected", approvalReason)
              }
              disabled={resolvingId === execution.id}
            >
              {resolvingId === execution.id ? "…" : "Reject"}
            </button>
          </div>
        </div>
      )}
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
          {decision.reason && (
            <div className={styles.decisionRow}>
              <span className={styles.decisionLabel}>Reason</span>
              <span className={styles.decisionValue}>{decision.reason}</span>
            </div>
          )}
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
