"use client";

import { useEffect, useState } from "react";
import {
  fetchSessionsByStatus,
  type Session,
  type SessionStatus,
} from "@/lib/utils/api";
import SessionDetail from "../sessions/[id]/SessionDetail";
import styles from "./page.module.css";

const STATUS_LABELS: Record<SessionStatus, string> = {
  RUNNING: "Running",
  AWAITING_INPUT: "Awaiting input",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
};

function pickSelectedSessionId(
  currentSessionId: string | null,
  nextSessions: Session[],
): string | null {
  if (
    currentSessionId &&
    nextSessions.some((session) => session.id === currentSessionId)
  ) {
    return currentSessionId;
  }

  return nextSessions[0]?.id ?? null;
}

export default function TodosPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSessionsByStatus("AWAITING_INPUT")
      .then((nextSessions) => {
        setError(null);
        setSessions(nextSessions);
        setSelectedSessionId((current) =>
          pickSelectedSessionId(current, nextSessions),
        );
      })
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : "Failed to load todo sessions",
        );
      })
      .finally(() => setLoading(false));
  }, []);

  function handleSessionUpdated(updatedSession: Session) {
    setSessions((currentSessions) => {
      const nextSessions =
        updatedSession.status === "AWAITING_INPUT"
          ? currentSessions.map((session) =>
              session.id === updatedSession.id ? updatedSession : session,
            )
          : currentSessions.filter(
              (session) => session.id !== updatedSession.id,
            );

      setSelectedSessionId((currentSessionId) =>
        pickSelectedSessionId(currentSessionId, nextSessions),
      );

      return nextSessions;
    });
  }

  const selectedSession =
    sessions.find((session) => session.id === selectedSessionId) ?? null;

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <aside className={styles.listPane}>
          <div className={styles.listHeader}>
            <p className={styles.eyebrow}>Todo Queue</p>
            <h1 className={styles.title}>Awaiting input</h1>
          </div>

          {loading ? (
            <p className={styles.status}>Loading…</p>
          ) : error ? (
            <p className={styles.error}>{error}</p>
          ) : sessions.length === 0 ? (
            <p className={styles.status}>No sessions are waiting for input.</p>
          ) : (
            <ul className={styles.list}>
              {sessions.map((session) => (
                <li key={session.id}>
                  <button
                    type="button"
                    className={`${styles.sessionButton} ${
                      session.id === selectedSessionId
                        ? styles.sessionButtonActive
                        : ""
                    }`}
                    aria-pressed={session.id === selectedSessionId}
                    onClick={() => setSelectedSessionId(session.id)}
                  >
                    <span className={styles.sessionTitle}>
                      {session.state_name ?? session.goal}
                    </span>
                    <span className={styles.sessionMeta}>
                      <span
                        className={`${styles.badge} ${styles[`badge-${session.status}`]}`}
                      >
                        {STATUS_LABELS[session.status]}
                      </span>
                      <span>
                        {new Date(session.updated_at).toLocaleString()}
                      </span>
                    </span>
                    <span className={styles.sessionBranch}>
                      {session.worktree_branch}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className={styles.detailPane}>
          {selectedSession ? (
            <SessionDetail
              key={selectedSession.id}
              session={selectedSession}
              onSessionUpdated={handleSessionUpdated}
            />
          ) : (
            <div className={styles.emptyDetail}>
              <p>Select a session to inspect its details.</p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
