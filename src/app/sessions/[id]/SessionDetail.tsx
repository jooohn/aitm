"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import WorkflowBreadcrumb from "@/app/components/WorkflowBreadcrumb";
import {
  failSession,
  fetchSession,
  replyToSession,
  type Session,
  type SessionStatus,
} from "@/lib/utils/api";
import { inferAlias } from "@/lib/utils/inferAlias";
import type { OutputItem, ToolGroupItem } from "@/lib/utils/outputItem";
import { parseLogEntry } from "@/lib/utils/parseLogEntry";
import OutputItemView from "./OutputItemView";
import styles from "./SessionDetail.module.css";

function appendWithGrouping(
  items: OutputItem[],
  newItem: OutputItem,
): OutputItem[] {
  if (newItem.kind !== "tool_call") {
    return [...items, newItem];
  }
  const last = items[items.length - 1];
  if (!last) {
    return [newItem];
  }
  // Last item is a ToolCallItem with the same toolName → merge into a ToolGroupItem
  if (last.kind === "tool_call" && last.toolName === newItem.toolName) {
    const group: ToolGroupItem = {
      kind: "tool_group",
      toolName: newItem.toolName,
      calls: [last, newItem],
    };
    return [...items.slice(0, -1), group];
  }
  // Last item is a ToolGroupItem with the same toolName → append to the group
  if (last.kind === "tool_group" && last.toolName === newItem.toolName) {
    const group: ToolGroupItem = {
      ...last,
      calls: [...last.calls, newItem],
    };
    return [...items.slice(0, -1), group];
  }
  return [...items, newItem];
}

interface Props {
  session: Session;
  onSessionUpdated?: (session: Session) => void;
}

const STATUS_LABELS: Record<SessionStatus, string> = {
  RUNNING: "Running",
  AWAITING_INPUT: "Awaiting input",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
};

const TERMINAL_STATUSES: SessionStatus[] = ["SUCCEEDED", "FAILED"];

export default function SessionDetail({
  session: initial,
  onSessionUpdated,
}: Props) {
  const [session, setSession] = useState<Session>(initial);
  const [outputItems, setOutputItems] = useState<OutputItem[]>([]);
  const [failing, setFailing] = useState(false);
  const [failError, setFailError] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const outputRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const isTerminal = TERMINAL_STATUSES.includes(session.status);

  useEffect(() => {
    setSession(initial);
  }, [initial]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset UI state when a different session is passed in
  useEffect(() => {
    setOutputItems([]);
    setFailing(false);
    setFailError(null);
    setReplyText("");
    setReplying(false);
    setReplyError(null);
    autoScrollRef.current = true;
  }, [initial]);

  const applySessionUpdate = useCallback(
    (updated: Session) => {
      setSession(updated);
      onSessionUpdated?.(updated);
    },
    [onSessionUpdated],
  );

  // SSE stream for live output
  useEffect(() => {
    const es = new EventSource(`/api/sessions/${session.id}/stream`);

    es.onmessage = (e) => {
      try {
        const entry = JSON.parse(e.data) as Record<string, unknown>;
        const parsed = parseLogEntry(entry);
        if (parsed === null) return;
        const newItems: OutputItem[] = Array.isArray(parsed)
          ? parsed
          : [parsed];
        setOutputItems((prev) => {
          let next = [...prev];
          for (const item of newItems) {
            next = appendWithGrouping(next, item);
          }
          return next;
        });
      } catch {
        // ignore malformed entries
      }
    };

    es.addEventListener("done", () => {
      es.close();
    });

    es.onerror = () => {
      es.close();
    };

    return () => es.close();
  }, [session.id]);

  // Auto-scroll output pane when new items arrive
  // biome-ignore lint/correctness/useExhaustiveDependencies: outputItems triggers the scroll
  useEffect(() => {
    if (autoScrollRef.current && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [outputItems]);

  // Poll for session status updates
  useEffect(() => {
    if (isTerminal) return;

    const interval = setInterval(async () => {
      try {
        const updated = await fetchSession(session.id);
        applySessionUpdate(updated);
        if (TERMINAL_STATUSES.includes(updated.status)) {
          clearInterval(interval);
        }
      } catch {
        // ignore poll errors
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [session.id, isTerminal, applySessionUpdate]);

  function handleOutputScroll() {
    if (!outputRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
    autoScrollRef.current = scrollTop + clientHeight >= scrollHeight - 10;
  }

  async function handleFail() {
    setFailing(true);
    setFailError(null);
    try {
      const updated = await failSession(session.id);
      applySessionUpdate(updated);
    } catch (err) {
      setFailError(
        err instanceof Error ? err.message : "Failed to mark session as failed",
      );
    } finally {
      setFailing(false);
    }
  }

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyText.trim()) return;
    setReplying(true);
    setReplyError(null);
    try {
      const updated = await replyToSession(session.id, replyText.trim());
      applySessionUpdate(updated);
      setReplyText("");
    } catch (err) {
      setReplyError(
        err instanceof Error ? err.message : "Failed to send reply",
      );
    } finally {
      setReplying(false);
    }
  }

  const repoAlias = inferAlias(session.repository_path);
  const [organization, repoName] = repoAlias.split("/");

  return (
    <div className={styles.container}>
      <WorkflowBreadcrumb
        repository={{ organization, name: repoName }}
        branch={session.worktree_branch}
        workflowRun={
          session.workflow_run_id && session.workflow_name
            ? { id: session.workflow_run_id, name: session.workflow_name }
            : undefined
        }
        stateExecution={
          session.state_name &&
          session.state_execution_id &&
          session.workflow_run_id
            ? {
                id: session.state_execution_id,
                workflowRunId: session.workflow_run_id,
                stateName: session.state_name,
              }
            : undefined
        }
        sessionLabel={session.state_name ?? session.id.slice(0, 8)}
      />
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span
            className={`${styles.badge} ${styles[`badge-${session.status}`]}`}
          >
            {STATUS_LABELS[session.status]}
          </span>
          {session.state_name && (
            <h1 className={styles.goal}>{session.state_name}</h1>
          )}
        </div>
        {!isTerminal && (
          <button
            type="button"
            className={styles.failButton}
            disabled={failing}
            onClick={handleFail}
          >
            {failing ? "Failing…" : "Mark as failed"}
          </button>
        )}
      </div>
      {failError && <p className={styles.error}>{failError}</p>}

      <section>
        <h2 className={styles.sectionHeading}>Goal</h2>
        <div className={styles.goalPane}>{session.goal}</div>
      </section>

      <section>
        <h2 className={styles.sectionHeading}>Session</h2>
        <div
          ref={outputRef}
          className={styles.output}
          onScroll={handleOutputScroll}
        >
          {outputItems.length === 0 ? (
            <span className={styles.outputEmpty}>No output yet…</span>
          ) : (
            outputItems.map((item, i) => <OutputItemView key={i} item={item} />)
          )}

          {session.status === "AWAITING_INPUT" && (
            <form onSubmit={handleReply} className={styles.replyForm}>
              <textarea
                className={styles.replyInput}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Type your reply…"
                disabled={replying}
                rows={3}
              />
              <button
                type="submit"
                className={styles.replyButton}
                disabled={replying || !replyText.trim()}
              >
                {replying ? "Sending…" : "Send reply"}
              </button>
              {replyError && <p className={styles.error}>{replyError}</p>}
            </form>
          )}
        </div>
      </section>

      {session.terminal_attach_command && (
        <dl className={styles.details}>
          <div className={styles.detailRow}>
            <dt className={styles.detailLabel}>Terminal attach</dt>
            <dd>
              <code className={styles.attachCommand}>
                {session.terminal_attach_command}
              </code>
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}
