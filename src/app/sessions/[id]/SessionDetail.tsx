"use client";

import { useEffect, useRef, useState } from "react";
import {
  failSession,
  fetchSession,
  fetchSessionMessages,
  type Session,
  type SessionMessage,
  type SessionStatus,
  sendMessage,
} from "@/lib/api";
import { formatLogEntry } from "@/lib/formatLogEntry";
import styles from "./SessionDetail.module.css";

interface Props {
  session: Session;
  initialMessages: SessionMessage[];
}

const STATUS_LABELS: Record<SessionStatus, string> = {
  RUNNING: "Running",
  WAITING_FOR_INPUT: "Waiting for input",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
};

const TERMINAL_STATUSES: SessionStatus[] = ["SUCCEEDED", "FAILED"];

export default function SessionDetail({
  session: initial,
  initialMessages,
}: Props) {
  const [session, setSession] = useState<Session>(initial);
  const [messages, setMessages] = useState<SessionMessage[]>(initialMessages);
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [replyContent, setReplyContent] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [failing, setFailing] = useState(false);
  const [failError, setFailError] = useState<string | null>(null);

  const outputRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const isTerminal = TERMINAL_STATUSES.includes(session.status);

  // SSE stream for live output
  useEffect(() => {
    const es = new EventSource(`/api/sessions/${session.id}/stream`);

    es.onmessage = (e) => {
      try {
        const entry = JSON.parse(e.data) as Record<string, unknown>;
        const text = formatLogEntry(entry);
        if (text !== null) {
          setOutputLines((prev) => [...prev, text]);
        }
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

  // Auto-scroll output pane when new lines arrive
  // biome-ignore lint/correctness/useExhaustiveDependencies: outputLines triggers the scroll
  useEffect(() => {
    if (autoScrollRef.current && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [outputLines]);

  // Poll for session status + messages updates
  useEffect(() => {
    if (isTerminal) return;

    const interval = setInterval(async () => {
      try {
        const [updated, msgs] = await Promise.all([
          fetchSession(session.id),
          fetchSessionMessages(session.id),
        ]);
        setSession(updated);
        setMessages(msgs);
        if (TERMINAL_STATUSES.includes(updated.status)) {
          clearInterval(interval);
        }
      } catch {
        // ignore poll errors
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [session.id, isTerminal]);

  function handleOutputScroll() {
    if (!outputRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
    autoScrollRef.current = scrollTop + clientHeight >= scrollHeight - 10;
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const content = replyContent.trim();
    if (!content) return;
    setSending(true);
    setSendError(null);
    try {
      await sendMessage(session.id, content);
      setReplyContent("");
      const [updated, msgs] = await Promise.all([
        fetchSession(session.id),
        fetchSessionMessages(session.id),
      ]);
      setSession(updated);
      setMessages(msgs);
    } catch (err) {
      setSendError(
        err instanceof Error ? err.message : "Failed to send message",
      );
    } finally {
      setSending(false);
    }
  }

  async function handleFail() {
    setFailing(true);
    setFailError(null);
    try {
      const updated = await failSession(session.id);
      setSession(updated);
    } catch (err) {
      setFailError(
        err instanceof Error ? err.message : "Failed to mark session as failed",
      );
    } finally {
      setFailing(false);
    }
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span
            className={`${styles.badge} ${styles[`badge-${session.status}`]}`}
          >
            {STATUS_LABELS[session.status]}
          </span>
          <h1 className={styles.goal}>{session.goal}</h1>
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

      {/* Details */}
      <dl className={styles.details}>
        <div className={styles.detailRow}>
          <dt className={styles.detailLabel}>Completion condition</dt>
          <dd className={styles.detailValue}>{session.completion_condition}</dd>
        </div>
        {session.terminal_attach_command && (
          <div className={styles.detailRow}>
            <dt className={styles.detailLabel}>Terminal attach</dt>
            <dd>
              <code className={styles.attachCommand}>
                {session.terminal_attach_command}
              </code>
            </dd>
          </div>
        )}
      </dl>

      {/* Output pane */}
      <section>
        <h2 className={styles.sectionHeading}>Output</h2>
        <div
          ref={outputRef}
          className={styles.output}
          onScroll={handleOutputScroll}
        >
          {outputLines.length === 0 ? (
            <span className={styles.outputEmpty}>No output yet…</span>
          ) : (
            outputLines.map((line, i) => (
              <div key={i} className={styles.outputLine}>
                {line}
              </div>
            ))
          )}
        </div>
      </section>

      {/* Message thread */}
      {messages.length > 0 && (
        <section>
          <h2 className={styles.sectionHeading}>Messages</h2>
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
        </section>
      )}

      {/* Input form */}
      {!isTerminal && (
        <form onSubmit={handleSend} className={styles.inputForm}>
          <textarea
            className={styles.textarea}
            placeholder={
              session.status === "WAITING_FOR_INPUT"
                ? "Reply to the agent…"
                : "Send a message…"
            }
            value={replyContent}
            onChange={(e) => setReplyContent(e.target.value)}
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
            disabled={sending || !replyContent.trim()}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </form>
      )}
      {sendError && <p className={styles.error}>{sendError}</p>}
    </div>
  );
}
