"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import EllipsisIcon from "@/app/components/icons/EllipsisIcon";
import ExternalLinkIcon from "@/app/components/icons/ExternalLinkIcon";
import type { StatusBadgeVariant } from "@/app/components/StatusBadge";
import StatusBadge from "@/app/components/StatusBadge";
import {
  canStopWorkflowRun,
  fetchWorkflowRun,
  fetchWorkflows,
  rerunWorkflowRun,
  rerunWorkflowRunFromFailedState,
  resolveManualApproval,
  type StepExecution,
  stopWorkflowRun,
  type WorkflowDefinition,
  type WorkflowRunDetail,
  type WorkflowRunStatus,
} from "@/lib/utils/api";
import { extractPullRequestUrl } from "@/lib/utils/extractPullRequestUrl";
import { inferAlias } from "@/lib/utils/inferAlias";
import { timeAgo } from "@/lib/utils/timeAgo";
import { workflowRunPath } from "@/lib/utils/workflowRunPath";
import RunWorkflowModal from "../RunWorkflowModal";
import { parseWorkflowRunInputs } from "./parseWorkflowRunInputs";
import styles from "./WorkflowRunDetail.module.css";
import WorkflowStepDiagram from "./WorkflowStepDiagram";

interface Props {
  run: WorkflowRunDetail;
  basePath?: string;
}

const STATUS_LABELS: Record<WorkflowRunStatus, string> = {
  running: "Running",
  awaiting: "Awaiting",
  success: "Success",
  failure: "Failure",
};

const TERMINAL_STATUSES: WorkflowRunStatus[] = ["success", "failure"];

type StepExecutionDisplayStatus =
  | "pending-approval"
  | "awaiting"
  | "running"
  | "completed";

function getStepExecutionDisplayStatus(
  execution: StepExecution,
): StepExecutionDisplayStatus {
  const isRunning = execution.completed_at === null;
  if (execution.step_type === "manual-approval" && isRunning)
    return "pending-approval";
  if (execution.status === "awaiting") return "awaiting";
  if (isRunning) return "running";
  return "completed";
}

const STEP_EXECUTION_BADGE: Record<
  StepExecutionDisplayStatus,
  { variant: StatusBadgeVariant; label: string }
> = {
  "pending-approval": {
    variant: "pending-approval",
    label: "Awaiting Approval",
  },
  awaiting: { variant: "awaiting", label: "Awaiting Input" },
  running: { variant: "running", label: "Running" },
  completed: { variant: "success", label: "Completed" },
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

function StepExecutionItem({
  execution,
  isCurrent,
  runBasePath,
  onResolve,
  resolvingId,
}: StepExecutionItemProps) {
  const [approvalReason, setApprovalReason] = useState("");
  const decision = parseDecision(execution.transition_decision);
  const displayStatus = getStepExecutionDisplayStatus(execution);
  const badge = STEP_EXECUTION_BADGE[displayStatus];
  const isCommandExecution = execution.step_type === "command";
  const isPendingApproval = displayStatus === "pending-approval";

  const statusVariant: StatusBadgeVariant = isPendingApproval
    ? "pending-approval"
    : displayStatus === "awaiting"
      ? "awaiting"
      : displayStatus === "running"
        ? "running"
        : execution.status === "failure"
          ? "failure"
          : "success";

  return (
    <li
      id={`step-execution-${execution.id}`}
      className={`${styles.execution} ${isCurrent ? (styles[`execution-${statusVariant}`] ?? "") : ""}`}
      data-status={statusVariant}
    >
      <div className={styles.executionHeader}>
        <span className={styles.stateName}>{execution.step}</span>
        <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge>
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

export default function WorkflowRunDetail({ run: initial, basePath }: Props) {
  const router = useRouter();
  const [run, setRun] = useState<WorkflowRunDetail>(initial);
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [rerunningFromFailed, setRerunningFromFailed] = useState(false);
  const [rerunFromFailedError, setRerunFromFailedError] = useState<
    string | null
  >(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [workflowDefinition, setWorkflowDefinition] =
    useState<WorkflowDefinition | null>(null);

  // Action menu state
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Launch workflow modal state
  const [showLaunchModal, setShowLaunchModal] = useState(false);

  const isTerminal = TERMINAL_STATUSES.includes(run.status);
  const inputEntries = parseWorkflowRunInputs(run.inputs);
  const inputLabelMap = new Map(
    workflowDefinition?.inputs?.map((i) => [i.name, i.label]),
  );
  const canStop = canStopWorkflowRun(run);
  const pullRequestUrl = extractPullRequestUrl(run.metadata);

  const handleStepClick = useCallback(
    (stepId: string) => {
      // Find the latest execution for this step
      const latest = [...run.step_executions]
        .reverse()
        .find((e) => e.step === stepId);
      if (!latest) return;
      const el = document.getElementById(`step-execution-${latest.id}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add(styles.highlight);
        setTimeout(() => el.classList.remove(styles.highlight), 1500);
      }
    },
    [run.step_executions],
  );

  async function handleRerun() {
    setRerunning(true);
    setRerunError(null);
    try {
      const newRun = await rerunWorkflowRun(run.id);
      router.push(workflowRunPath(newRun));
    } catch (err) {
      setRerunError(err instanceof Error ? err.message : "Re-run failed");
    } finally {
      setRerunning(false);
    }
  }

  async function handleStop() {
    setStopping(true);
    setStopError(null);
    try {
      const updated = await stopWorkflowRun(run.id);
      setRun(updated);
    } catch (err) {
      setStopError(err instanceof Error ? err.message : "Stop failed");
    } finally {
      setStopping(false);
    }
  }

  async function handleResolve(
    executionId: string,
    decision: "approved" | "rejected",
    reason: string,
  ) {
    setResolvingId(executionId);
    try {
      const updated = await resolveManualApproval(
        run.id,
        decision,
        reason || undefined,
      );
      setRun(updated);
    } catch {
      // ignore resolve errors — the poll will pick up the state
    } finally {
      setResolvingId(null);
    }
  }

  async function handleRerunFromFailed() {
    setRerunningFromFailed(true);
    setRerunFromFailedError(null);
    try {
      const updated = await rerunWorkflowRunFromFailedState(run.id);
      setRun(updated);
    } catch (err) {
      setRerunFromFailedError(
        err instanceof Error ? err.message : "Re-run from failed state failed",
      );
    } finally {
      setRerunningFromFailed(false);
    }
  }

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  function openLaunchModal() {
    setMenuOpen(false);
    setShowLaunchModal(true);
  }

  function handleMenuRerun() {
    setMenuOpen(false);
    handleRerun();
  }

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

  useEffect(() => {
    fetchWorkflows()
      .then((workflows) => {
        const def = workflows[run.workflow_name];
        if (def) setWorkflowDefinition(def);
      })
      .catch(() => {
        // ignore fetch errors for workflow definition
      });
  }, [run.workflow_name]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>
            <Link
              href={`/repositories/${inferAlias(run.repository_path)}/worktrees/${run.worktree_branch}`}
              className={styles.titleBranchLink}
            >
              {run.worktree_branch}
            </Link>
            <span className={styles.titleSeparator}>/</span>
            {run.workflow_name}
            <span className={styles.titleRunId}>({run.id})</span>
          </h1>
          <div className={styles.headerMeta}>
            <StatusBadge variant={run.status}>
              {STATUS_LABELS[run.status]}
            </StatusBadge>
            <p className={styles.headerTimestamps}>
              Created {timeAgo(run.created_at)}, Last modified{" "}
              {timeAgo(run.updated_at)}
            </p>
          </div>
        </div>
        <div className={styles.headerRight}>
          {run.status === "failure" && (
            <div className={styles.headerActions}>
              <button
                className={styles.rerunButton}
                onClick={handleRerun}
                disabled={rerunning}
              >
                {rerunning ? "Re-running…" : "Re-run"}
              </button>
              <button
                className={styles.rerunButton}
                onClick={handleRerunFromFailed}
                disabled={rerunningFromFailed}
              >
                {rerunningFromFailed
                  ? "Re-running…"
                  : "Re-run from failed step"}
              </button>
              {rerunError && <p className={styles.rerunError}>{rerunError}</p>}
              {rerunFromFailedError && (
                <p className={styles.rerunError}>{rerunFromFailedError}</p>
              )}
            </div>
          )}
          <div className={styles.menuWrapper} ref={menuRef}>
            <button
              type="button"
              className={styles.menuButton}
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="Actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title="Actions"
            >
              <EllipsisIcon />
            </button>
            {menuOpen && (
              <div className={styles.menu} role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={handleMenuRerun}
                  disabled={rerunning}
                >
                  {rerunning ? "Re-running…" : "Re-run"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={openLaunchModal}
                >
                  Run another workflow
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {pullRequestUrl && (
        <a
          href={pullRequestUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.prBanner}
        >
          <span className={styles.prBannerText}>
            Pull request created:{" "}
            <span className={styles.prBannerUrl}>
              {pullRequestUrl.match(/\/pull\/(\d+)/)
                ? `${pullRequestUrl.match(/github\.com\/([^/]+\/[^/]+)/)?.[1]}#${pullRequestUrl.match(/\/pull\/(\d+)/)?.[1]}`
                : pullRequestUrl}
            </span>
            <ExternalLinkIcon size={14} className={styles.prBannerIcon} />
          </span>
        </a>
      )}

      {inputEntries.length > 0 && (
        <section>
          <h2 className={styles.sectionHeading}>Inputs</h2>
          <dl className={styles.details}>
            {inputEntries.map((entry) => (
              <div key={entry.key} className={styles.detailRow}>
                <dt className={styles.detailLabel}>
                  {inputLabelMap.get(entry.key) ?? entry.key}
                </dt>
                <dd className={styles.detailValue}>{entry.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {workflowDefinition && (
        <section>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionHeading}>Step diagram</h2>
            {canStop && (
              <div className={styles.stopActions}>
                <button
                  className={styles.stopButton}
                  onClick={handleStop}
                  disabled={stopping}
                >
                  {stopping ? "Stopping…" : "Stop Immediately"}
                </button>
                {stopError && <p className={styles.rerunError}>{stopError}</p>}
              </div>
            )}
          </div>
          <WorkflowStepDiagram
            definition={workflowDefinition}
            stepExecutions={run.step_executions}
            currentStep={run.current_step}
            status={run.status}
            onStepClick={handleStepClick}
          />
        </section>
      )}

      <section>
        <h2 className={styles.sectionHeading}>Step executions</h2>
        {run.step_executions.length === 0 ? (
          <p className={styles.empty}>No step executions yet.</p>
        ) : (
          <ul className={styles.executions}>
            {[...run.step_executions].reverse().map((execution, index) => (
              <StepExecutionItem
                key={execution.id}
                execution={execution}
                isCurrent={index === 0}
                runBasePath={
                  basePath ??
                  `/repositories/${inferAlias(run.repository_path)}/workflow-runs/${run.id}`
                }
                onResolve={handleResolve}
                resolvingId={resolvingId}
              />
            ))}
          </ul>
        )}
      </section>

      {showLaunchModal && (
        <RunWorkflowModal
          onClose={() => setShowLaunchModal(false)}
          fixedAlias={inferAlias(run.repository_path)}
          fixedBranch={run.worktree_branch}
        />
      )}
    </div>
  );
}
