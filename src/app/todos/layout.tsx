"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchSessionsByStatus, type Session } from "@/lib/utils/api";
import { inferAlias } from "@/lib/utils/inferAlias";
import styles from "./page.module.css";

export default function TodosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSessionsByStatus("AWAITING_INPUT")
      .then((nextSessions) => {
        setError(null);
        setSessions(nextSessions);
      })
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : "Failed to load todo sessions",
        );
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <aside className={styles.listPane}>
          <div className={styles.listHeader}>
            <h1 className={styles.title}>Todo List</h1>
          </div>

          {loading ? (
            <p className={styles.status}>Loading…</p>
          ) : error ? (
            <p className={styles.error}>{error}</p>
          ) : sessions.length === 0 ? (
            <p className={styles.status}>No sessions are waiting for input.</p>
          ) : (
            <ul className={styles.list}>
              {sessions.map((session) => {
                const href = `/todos/session-${session.id}`;
                const isActive = pathname === href;
                return (
                  <li key={session.id}>
                    <Link
                      href={href}
                      className={`${styles.sessionLink} ${
                        isActive ? styles.sessionLinkActive : ""
                      }`}
                    >
                      <span className={styles.sessionPrimary}>
                        {inferAlias(session.repository_path)}
                        {" - "}
                        {session.worktree_branch}
                      </span>
                      <span className={styles.sessionSecondary}>
                        {session.state_name && (
                          <span>{session.state_name}</span>
                        )}
                        {session.workflow_name && (
                          <span>{session.workflow_name}</span>
                        )}
                        <span>
                          {new Date(session.updated_at).toLocaleString()}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className={styles.detailPane}>{children}</section>
      </section>
    </main>
  );
}
