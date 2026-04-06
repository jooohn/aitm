"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  canStopWorkflowRun,
  fetchWorkflowRun,
  fetchWorkflows,
  rerunWorkflowRun,
  rerunWorkflowRunFromFailedState,
  type StepExecution,
  stopWorkflowRun,
  type WorkflowDefinition,
  type WorkflowRunDetail,
  type WorkflowRunStatus,
} from "@/lib/utils/api";
import { extractPullRequestUrl } from "@/lib/utils/extractPullRequestUrl";
import { inferAlias } from "@/lib/utils/inferAlias";
import { workflowRunPath } from "@/lib/utils/workflowRunPath";
import { parseWorkflowRunInputs } from "./parseWorkflowRunInputs";
import styles from "./WorkflowRunDetail.module.css";
import WorkflowStepDiagram from "./WorkflowStepDiagram";

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

interface StepExecutionItemProps {
  execution: StepExecution;
}

function StepExecutionItem({ execution }: StepExecutionItemProps) {
  const {
    organization,
    name,
    id: runId,
  } = useParams<{
    organization: string;
    name: string;
    id: string;
  }>();
  const decision = parseDecision(execution.transition_decision);
  const isRunning = execution.completed_at === null;
  const isCommandExecution = execution.step_type === "command";

  return (
    <li id={`step-execution-${execution.id}`} className={styles.execution}>
      <div className={styles.executionHeader}>
        <span className={styles.stateName}>{execution.step}</span>
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
        {execution.session_id && (
          <Link
            href={`/repositories/${organization}/${name}/workflow-runs/${runId}/sessions/${execution.session_id}`}
            className={styles.sessionLink}
          >
            Session {execution.session_id.slice(0, 8)}…
          </Link>
        )}
        <span className={styles.timestamp}>
          {new Date(execution.created_at).toLocaleString()}
        </span>
      </div>
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

export default function WorkflowRunDetail({ run: initial }: Props) {
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
  const [workflowDefinition, setWorkflowDefinition] =
    useState<WorkflowDefinition | null>(null);

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
          <span className={`${styles.badge} ${styles[`badge-${run.status}`]}`}>
            {STATUS_LABELS[run.status]}
          </span>
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
          <p className={styles.headerTimestamps}>
            Created at {new Date(run.created_at).toLocaleString()}, Last
            modified at {new Date(run.updated_at).toLocaleString()}
          </p>
        </div>
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
              {rerunningFromFailed ? "Re-running…" : "Re-run from failed step"}
            </button>
            {rerunError && <p className={styles.rerunError}>{rerunError}</p>}
            {rerunFromFailedError && (
              <p className={styles.rerunError}>{rerunFromFailedError}</p>
            )}
          </div>
        )}
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
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={styles.prBannerIcon}
              aria-hidden="true"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </span>
        </a>
      )}

      {inputEntries.length > 0 && (
        <h2 className={styles.sectionHeading}>Inputs</h2>
      )}
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
            {[...run.step_executions].reverse().map((execution) => (
              <StepExecutionItem key={execution.id} execution={execution} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
