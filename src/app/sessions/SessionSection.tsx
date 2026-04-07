"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { StatusBadgeVariant } from "@/app/components/StatusBadge";
import StatusBadge from "@/app/components/StatusBadge";
import {
  fetchSessions,
  type Session,
  type SessionStatus,
} from "@/lib/utils/api";
import { inferAlias } from "@/lib/utils/inferAlias";
import styles from "./SessionSection.module.css";

interface Props {
  repositoryPath: string;
  branch: string;
}

const STATUS_LABELS: Record<SessionStatus, string> = {
  running: "Running",
  awaiting_input: "Awaiting input",
  success: "Succeeded",
  failure: "Failed",
};

const SESSION_BADGE_VARIANT: Record<SessionStatus, StatusBadgeVariant> = {
  running: "running",
  awaiting_input: "awaiting",
  success: "success",
  failure: "failure",
};

export default function SessionSection({ repositoryPath, branch }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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
                <Link
                  href={
                    session.workflow_run_id
                      ? `/repositories/${inferAlias(session.repository_path)}/workflow-runs/${session.workflow_run_id}/sessions/${session.id}`
                      : `/sessions/${session.id}`
                  }
                  className={styles.goal}
                >
                  {session.step_name ?? session.goal}
                </Link>
                <div className={styles.meta}>
                  <StatusBadge variant={SESSION_BADGE_VARIANT[session.status]}>
                    {STATUS_LABELS[session.status]}
                  </StatusBadge>
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
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
