"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  failSession,
  fetchSessions,
  type Session,
  type SessionStatus,
  sendMessage,
} from "@/lib/utils/api";
import styles from "./SessionSection.module.css";

interface Props {
  repositoryPath: string;
  branch: string;
}

const STATUS_LABELS: Record<SessionStatus, string> = {
  RUNNING: "Running",
  WAITING_FOR_INPUT: "Waiting for input",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
};

const TERMINAL_STATUSES: SessionStatus[] = ["SUCCEEDED", "FAILED"];

export default function SessionSection({ repositoryPath, branch }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [failingId, setFailingId] = useState<string | null>(null);
  const [failError, setFailError] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState<Record<string, string>>({});
  const [sendingReplyId, setSendingReplyId] = useState<string | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      setSessions(await fetchSessions(repositoryPath, branch));
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load sessions",
      );
    } finally {
      setLoading(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load only on mount
  useEffect(() => {
    load();
  }, []);

  async function handleFail(session: Session) {
    setFailingId(session.id);
    setFailError(null);
    try {
      await failSession(session.id);
      await load();
    } catch (err) {
      setFailError(
        err instanceof Error ? err.message : "Failed to mark session as failed",
      );
    } finally {
      setFailingId(null);
    }
  }

  async function handleReply(e: React.FormEvent, session: Session) {
    e.preventDefault();
    const content = replyContent[session.id]?.trim();
    if (!content) return;
    setSendingReplyId(session.id);
    setReplyError(null);
    try {
      await sendMessage(session.id, content);
      setReplyContent((prev) => ({ ...prev, [session.id]: "" }));
      await load();
    } catch (err) {
      setReplyError(
        err instanceof Error ? err.message : "Failed to send message",
      );
    } finally {
      setSendingReplyId(null);
    }
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Sessions</h2>

      {loading && <p className={styles.status}>Loading…</p>}
      {loadError && <p className={styles.error}>{loadError}</p>}

      {!loading && !loadError && (
        <ul className={styles.list}>
          {sessions.length === 0 && (
            <li className={styles.status}>No sessions yet.</li>
          )}
          {sessions.map((session) => (
            <li key={session.id} className={styles.item}>
              <div className={styles.info}>
                <Link href={`/sessions/${session.id}`} className={styles.goal}>
                  {session.goal}
                </Link>
                <div className={styles.meta}>
                  <span
                    className={`${styles.badge} ${styles[`badge-${session.status}`]}`}
                  >
                    {STATUS_LABELS[session.status]}
                  </span>
                  <span>
                    {" "}
                    · {new Date(session.created_at).toLocaleString()}
                  </span>
                </div>
                {session.terminal_attach_command && (
                  <code className={styles.attachCommand}>
                    {session.terminal_attach_command}
                  </code>
                )}
                {session.status === "WAITING_FOR_INPUT" && (
                  <form
                    onSubmit={(e) => handleReply(e, session)}
                    className={styles.replyForm}
                  >
                    <textarea
                      className={styles.textarea}
                      placeholder="Your reply…"
                      value={replyContent[session.id] ?? ""}
                      onChange={(e) =>
                        setReplyContent((prev) => ({
                          ...prev,
                          [session.id]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                          handleReply(e as unknown as React.FormEvent, session);
                        }
                      }}
                      disabled={sendingReplyId === session.id}
                    />
                    <button
                      type="submit"
                      className={styles.replyButton}
                      disabled={
                        sendingReplyId === session.id ||
                        !replyContent[session.id]?.trim()
                      }
                    >
                      {sendingReplyId === session.id ? "Sending…" : "Send"}
                    </button>
                  </form>
                )}
              </div>
              {!TERMINAL_STATUSES.includes(session.status) && (
                <button
                  type="button"
                  className={styles.failButton}
                  disabled={failingId === session.id}
                  onClick={() => handleFail(session)}
                >
                  {failingId === session.id ? "Failing…" : "Fail"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {failError && <p className={styles.error}>{failError}</p>}
      {replyError && <p className={styles.error}>{replyError}</p>}
    </section>
  );
}
