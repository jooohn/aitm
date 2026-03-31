"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  fetchSessionMessages,
  fetchWorkflowRun,
  rerunWorkflowRun,
  rerunWorkflowRunFromFailedState,
  type SessionMessage,
  type StateExecution,
  sendMessage,
  submitWorkflowRunInput,
  type WorkflowRunDetail,
  type WorkflowRunStatus,
} from "@/lib/utils/api";
import styles from "./WorkflowRunDetail.module.css";

interface Props {
  run: WorkflowRunDetail;
}

const STATUS_LABELS: Record<WorkflowRunStatus, string> = {
  running: "Running",
  success: "Success",
  failure: "Failure",
  waiting_for_input: "Waiting for input",
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

interface StateExecutionItemProps {
  execution: StateExecution;
  messages: SessionMessage[];
  onSendMessage: (sessionId: string, content: string) => Promise<void>;
}

function StateExecutionItem({
  execution,
  messages,
  onSendMessage,
}: StateExecutionItemProps) {
  const decision = parseDecision(execution.transition_decision);
  const isRunning = execution.completed_at === null;
  const isWaiting = execution.session_status === "WAITING_FOR_INPUT";
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const content = reply.trim();
    if (!content) return;
    setSending(true);
    try {
      await onSendMessage(execution.session_id!, content);
      setReply("");
    } finally {
      setSending(false);
    }
  }

  return (
    <li className={styles.execution}>
      <div className={styles.executionHeader}>
        <span className={styles.stateName}>{execution.state}</span>
        {isRunning ? (
          <span
            className={`${styles.badge} ${
              isWaiting ? styles["badge-waiting"] : styles["badge-running"]
            }`}
          >
            {isWaiting ? "Waiting for input" : "Running"}
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
      {isWaiting && messages.length > 0 && (
        <div className={styles.questionSection}>
          <ul className={styles.messages}>
            {messages.map((msg) => (
              <li
                key={msg.id}
                className={`${styles.message} ${styles[`message-${msg.role}`]}`}
              >
                <span className={styles.messageRole}>
                  {msg.role === "agent" ? "Agent" : "You"}
                </span>
                <span className={styles.messageContent}>{msg.content}</span>
              </li>
            ))}
          </ul>
          <form onSubmit={handleSend} className={styles.inputForm}>
            <textarea
              className={styles.textarea}
              placeholder="Reply to the agent…"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  handleSend(e as unknown as React.FormEvent);
                }
              }}
              disabled={sending}
            />
            <button
              type="submit"
              className={styles.sendButton}
              disabled={sending || !reply.trim()}
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </form>
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

interface WaitForInputFormProps {
  context: string | null;
  onSubmit: (userInput: string) => Promise<void>;
}

function WaitForInputForm({ context, onSubmit }: WaitForInputFormProps) {
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      setInput("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={styles.waitForInputSection}>
      <h2 className={styles.sectionHeading}>
        Provide clarification to continue
      </h2>
      {context && <div className={styles.waitForInputContext}>{context}</div>}
      <form onSubmit={handleSubmit} className={styles.inputForm}>
        <textarea
          className={styles.textarea}
          placeholder="Your response…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              handleSubmit(e as unknown as React.FormEvent);
            }
          }}
          disabled={submitting}
        />
        <button
          type="submit"
          className={styles.sendButton}
          disabled={submitting || !input.trim()}
        >
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </form>
    </section>
  );
}

export default function WorkflowRunDetail({ run: initial }: Props) {
  const router = useRouter();
  const [run, setRun] = useState<WorkflowRunDetail>(initial);
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [rerunningFromFailed, setRerunningFromFailed] = useState(false);
  const [rerunFromFailedError, setRerunFromFailedError] = useState<
    string | null
  >(null);
  // messages keyed by session_id for waiting executions
  const [sessionMessages, setSessionMessages] = useState<
    Record<string, SessionMessage[]>
  >({});

  const isTerminal = TERMINAL_STATUSES.includes(run.status);

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

  async function handleSubmitInput(userInput: string) {
    const updated = await submitWorkflowRunInput(run.id, userInput);
    setRun(updated);
  }

  async function handleSendMessage(sessionId: string, content: string) {
    await sendMessage(sessionId, content);
    const msgs = await fetchSessionMessages(sessionId);
    setSessionMessages((prev) => ({ ...prev, [sessionId]: msgs }));
  }

  // Fetch messages for sessions already waiting on mount
  useEffect(() => {
    const waiting = initial.state_executions.filter(
      (e) => e.session_status === "WAITING_FOR_INPUT" && e.session_id != null,
    );
    if (waiting.length === 0) return;
    Promise.all(
      waiting.map(async (e) => {
        const msgs = await fetchSessionMessages(e.session_id!);
        return [e.session_id!, msgs] as const;
      }),
    ).then((entries) => {
      setSessionMessages(Object.fromEntries(entries));
    });
  }, [initial]);

  useEffect(() => {
    if (isTerminal) return;

    const interval = setInterval(async () => {
      try {
        const updated = await fetchWorkflowRun(run.id);
        setRun(updated);

        // Fetch messages for any session waiting for input
        const waiting = updated.state_executions.filter(
          (e) =>
            e.session_status === "WAITING_FOR_INPUT" && e.session_id != null,
        );
        if (waiting.length > 0) {
          const entries = await Promise.all(
            waiting.map(async (e) => {
              const msgs = await fetchSessionMessages(e.session_id!);
              return [e.session_id!, msgs] as const;
            }),
          );
          setSessionMessages((prev) => ({
            ...prev,
            ...Object.fromEntries(entries),
          }));
        }

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
              {rerunningFromFailed ? "Re-running…" : "Re-run from failed state"}
            </button>
            {rerunError && <p className={styles.rerunError}>{rerunError}</p>}
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

      {run.status === "waiting_for_input" && (
        <WaitForInputForm
          context={
            run.state_executions
              .filter((e) => e.completed_at !== null && e.handoff_summary)
              .at(-1)?.handoff_summary ?? null
          }
          onSubmit={handleSubmitInput}
        />
      )}

      <section>
        <h2 className={styles.sectionHeading}>State executions</h2>
        {run.state_executions.length === 0 ? (
          <p className={styles.empty}>No state executions yet.</p>
        ) : (
          <ul className={styles.executions}>
            {run.state_executions.map((execution) => (
              <StateExecutionItem
                key={execution.id}
                execution={execution}
                messages={
                  (execution.session_id
                    ? sessionMessages[execution.session_id]
                    : null) ?? []
                }
                onSendMessage={handleSendMessage}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
