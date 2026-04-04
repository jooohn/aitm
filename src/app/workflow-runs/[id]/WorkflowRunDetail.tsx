"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
  const decision = parseDecision(execution.transition_decision);
  const isRunning = execution.completed_at === null;
  const isCommandExecution = execution.step_type === "command";

  return (
    <li className={styles.execution}>
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
            href={`/sessions/${execution.session_id}`}
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
  const canStop = canStopWorkflowRun(run);
  const pullRequestUrl = extractPullRequestUrl(run.metadata);

  async function handleRerun() {
    setRerunning(true);
    setRerunError(null);
    try {
      const newRun = await rerunWorkflowRun(run.id);
      router.push(`/workflow-runs/${newRun.id}`);
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
      setStopError(
        err instanceof Error ? err.message : "Emergency stop failed",
      );
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
      <div className={styles.layout} data-testid="workflow-run-layout">
        <div className={styles.leftPane} data-testid="workflow-run-left-pane">
          {workflowDefinition && (
            <section>
              <h2 className={styles.sectionHeading}>Step diagram</h2>
              <WorkflowStepDiagram
                definition={workflowDefinition}
                stepExecutions={run.step_executions}
                currentStep={run.current_step}
                status={run.status}
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

        <div className={styles.rightPane} data-testid="workflow-run-right-pane">
          <div className={styles.header}>
            <div className={styles.headerLeft}>
              <span
                className={`${styles.badge} ${styles[`badge-${run.status}`]}`}
              >
                {STATUS_LABELS[run.status]}
              </span>
              <h1 className={styles.title}>{run.workflow_name}</h1>
            </div>
            {canStop && (
              <div className={styles.headerActions}>
                <button
                  className={styles.stopButton}
                  onClick={handleStop}
                  disabled={stopping}
                >
                  {stopping ? "Stopping…" : "Emergency stop"}
                </button>
                {stopError && <p className={styles.rerunError}>{stopError}</p>}
              </div>
            )}
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
                {rerunError && (
                  <p className={styles.rerunError}>{rerunError}</p>
                )}
                {rerunFromFailedError && (
                  <p className={styles.rerunError}>{rerunFromFailedError}</p>
                )}
              </div>
            )}
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
            {run.current_step && (
              <div className={styles.detailRow}>
                <dt className={styles.detailLabel}>Current step</dt>
                <dd className={styles.detailValue}>{run.current_step}</dd>
              </div>
            )}
            <div className={styles.detailRow}>
              <dt className={styles.detailLabel}>Started</dt>
              <dd className={styles.detailValue}>
                {new Date(run.created_at).toLocaleString()}
              </dd>
            </div>
            {pullRequestUrl && (
              <div className={styles.detailRow}>
                <dt className={styles.detailLabel}>Pull request</dt>
                <dd className={styles.detailValue}>
                  <a
                    href={pullRequestUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {pullRequestUrl}
                  </a>
                </dd>
              </div>
            )}
            {inputEntries.length > 0 && (
              <div className={styles.detailRow}>
                <dt className={styles.detailLabel}>Inputs</dt>
                <dd className={styles.detailValue}>
                  <dl className={styles.inputsList}>
                    {inputEntries.map((entry) => (
                      <div key={entry.key} className={styles.inputItem}>
                        <dt className={styles.inputKey}>{entry.key}</dt>
                        <dd className={styles.inputValue}>{entry.value}</dd>
                      </div>
                    ))}
                  </dl>
                </dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </div>
  );
}
