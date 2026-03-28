"use client";

import { useEffect, useState } from "react";
import {
  failSession,
  fetchSessions,
  type Session,
  type SessionStatus,
  startSession,
} from "@/lib/api";
import styles from "./SessionSection.module.css";

interface Props {
  repositoryId: number;
  organization: string;
  name: string;
  branch: string;
}

const STATUS_LABELS: Record<SessionStatus, string> = {
  RUNNING: "Running",
  WAITING_FOR_INPUT: "Waiting for input",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
};

const TERMINAL_STATUSES: SessionStatus[] = ["SUCCEEDED", "FAILED"];

export default function SessionSection({
  repositoryId,
  organization,
  name,
  branch,
}: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [goal, setGoal] = useState("");
  const [completionCondition, setCompletionCondition] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [failingId, setFailingId] = useState<string | null>(null);
  const [failError, setFailError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      setSessions(await fetchSessions(repositoryId, branch));
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

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    setStarting(true);
    setStartError(null);
    try {
      await startSession({
        organization,
        name,
        worktree_branch: branch,
        goal,
        completion_condition: completionCondition,
      });
      setGoal("");
      setCompletionCondition("");
      await load();
    } catch (err) {
      setStartError(
        err instanceof Error ? err.message : "Failed to start session",
      );
    } finally {
      setStarting(false);
    }
  }

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
                <div className={styles.goal}>{session.goal}</div>
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

      <form onSubmit={handleStart} className={styles.form}>
        <div className={styles.formRow}>
          <label className={styles.label} htmlFor="session-goal">
            Goal
          </label>
          <textarea
            id="session-goal"
            className={styles.textarea}
            placeholder="What should the agent accomplish?"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            disabled={starting}
            required
          />
        </div>
        <div className={styles.formRow}>
          <label className={styles.label} htmlFor="session-completion">
            Completion condition
          </label>
          <textarea
            id="session-completion"
            className={styles.textarea}
            placeholder="When is the session done? e.g. Implementation plan has been written and reviewed by user"
            value={completionCondition}
            onChange={(e) => setCompletionCondition(e.target.value)}
            disabled={starting}
            required
          />
        </div>
        <button
          type="submit"
          className={styles.startButton}
          disabled={starting || !goal.trim() || !completionCondition.trim()}
        >
          {starting ? "Starting…" : "Start session"}
        </button>
      </form>
      {startError && <p className={styles.error}>{startError}</p>}
    </section>
  );
}
