"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useNotificationStream } from "@/lib/hooks/useNotificationStream";
import { fetchAllWorkflowRuns, type WorkflowRun } from "@/lib/utils/api";
import { inferAlias } from "@/lib/utils/inferAlias";
import { timeAgo } from "@/lib/utils/timeAgo";
import styles from "./page.module.css";

export default function TodosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [items, setItems] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchAllWorkflowRuns("awaiting")
      .then((runs) => {
        setError(null);
        setItems(runs);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load todos");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useNotificationStream(refresh);

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
          ) : items.length === 0 ? (
            <p className={styles.status}>No items are waiting for action.</p>
          ) : (
            <ul className={styles.list}>
              {items.map((run) => {
                const href = `/todos/${run.id}`;
                const isActive = pathname === href;
                return (
                  <li key={run.id}>
                    <Link
                      href={href}
                      className={`${styles.sessionLink} ${
                        isActive ? styles.sessionLinkActive : ""
                      }`}
                    >
                      <span className={styles.sessionPrimary}>
                        {run.worktree_branch}
                      </span>
                      <span className={styles.sessionSecondary}>
                        <span>{inferAlias(run.repository_path)}</span>
                        <span>{timeAgo(run.updated_at)}</span>
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
