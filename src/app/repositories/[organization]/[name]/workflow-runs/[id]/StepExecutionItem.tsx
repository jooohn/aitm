"use client";

import Link from "next/link";
import { useState } from "react";
import StatusBadge from "@/app/components/StatusBadge";
import type { StepExecution } from "@/lib/utils/api";
import styles from "./WorkflowRunDetail.module.css";

const STATUS_LABELS: Record<StepExecution["status"], string> = {
  awaiting: "Awaiting",
  running: "Running",
  success: "Success",
  failure: "Failure",
};

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

interface StepExecutionItemProps {
  execution: StepExecution;
  isCurrent: boolean;
  runBasePath: string;
  onResolve?: (
    executionId: string,
    decision: "approved" | "rejected",
    reason: string,
  ) => void;
  resolvingId?: string | null;
}

export default function StepExecutionItem({
  execution,
  isCurrent,
  runBasePath,
  onResolve,
  resolvingId,
}: StepExecutionItemProps) {
  const [approvalReason, setApprovalReason] = useState("");
  const decision = parseDecision(execution.transition_decision);
  const isCommandExecution = execution.step_type === "command";
  const isPendingApproval =
    execution.step_type === "manual-approval" &&
    execution.status === "awaiting";

  return (
    <li
      id={`step-execution-${execution.id}`}
      className={`${styles.execution} ${isCurrent ? (styles[`execution-${execution.status}`] ?? "") : ""}`}
      data-status={execution.status}
    >
      <div className={styles.executionHeader}>
        <span className={styles.stateName}>{execution.step}</span>
        <StatusBadge variant={execution.status}>
          {STATUS_LABELS[execution.status]}
        </StatusBadge>
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
        <span className={styles.timestamp}>
          {new Date(execution.created_at).toLocaleString()}
        </span>
      </div>
      {isPendingApproval && onResolve && (
        <div className={styles.approvalSection}>
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
      {(decision || isCommandExecution) && (
        <div className={styles.decision}>
          {decision && (
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
          )}
          {isCommandExecution ? (
            <div className={styles.decisionColumn}>
              <span className={styles.decisionLabel}>Output</span>
              <div
                className={styles.commandOutput}
                data-testid={`command-output-${execution.id}`}
              >
                {execution.command_output ? (
                  <div className={styles.commandOutputLine}>
                    {execution.command_output}
                  </div>
                ) : (
                  <div
                    className={`${styles.commandOutputLine} ${styles.commandOutputEmpty}`}
                  >
                    No output captured.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {decision && (
                <div className={styles.decisionRow}>
                  <span className={styles.decisionLabel}>Reason</span>
                  <span className={styles.decisionValue}>
                    {decision.reason}
                  </span>
                </div>
              )}
              {decision?.handoff_summary && (
                <div className={styles.decisionRow}>
                  <span className={styles.decisionLabel}>Summary</span>
                  <span className={styles.decisionValue}>
                    {decision.handoff_summary}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}
