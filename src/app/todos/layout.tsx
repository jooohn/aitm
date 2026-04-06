"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useNotificationStream } from "@/lib/hooks/useNotificationStream";
import {
  fetchPendingApprovals,
  fetchSessionsByStatus,
  type PendingApproval,
  type Session,
} from "@/lib/utils/api";
import { inferAlias } from "@/lib/utils/inferAlias";
import styles from "./page.module.css";

type TodoItem =
  | { kind: "session"; session: Session }
  | { kind: "approval"; approval: PendingApproval };

export default function TodosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [items, setItems] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    Promise.all([
      fetchSessionsByStatus("AWAITING_INPUT"),
      fetchPendingApprovals(),
    ])
      .then(([sessions, approvals]) => {
        setError(null);
        const todoItems: TodoItem[] = [
          ...sessions.map(
            (session): TodoItem => ({ kind: "session", session }),
          ),
          ...approvals.map(
            (approval): TodoItem => ({ kind: "approval", approval }),
          ),
        ];
        todoItems.sort((a, b) => {
          const aTime =
            a.kind === "session" ? a.session.updated_at : a.approval.created_at;
          const bTime =
            b.kind === "session" ? b.session.updated_at : b.approval.created_at;
          return bTime.localeCompare(aTime);
        });
        setItems(todoItems);
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
              {items.map((item) => {
                if (item.kind === "session") {
                  const { session } = item;
                  const href = `/todos/session-${session.id}`;
                  const isActive = pathname === href;
                  return (
                    <li key={`session-${session.id}`}>
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
                          <span className={styles.todoBadgeInput}>
                            Awaiting Input
                          </span>
                          {session.step_name && (
                            <span>{session.step_name}</span>
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
                }
                const { approval } = item;
                const href = `/todos/approval-${approval.workflow_run_id}`;
                const isActive = pathname === href;
                return (
                  <li key={`approval-${approval.step_execution_id}`}>
                    <Link
                      href={href}
                      className={`${styles.sessionLink} ${
                        isActive ? styles.sessionLinkActive : ""
                      }`}
                    >
                      <span className={styles.sessionPrimary}>
                        {inferAlias(approval.repository_path)}
                        {" - "}
                        {approval.worktree_branch}
                      </span>
                      <span className={styles.sessionSecondary}>
                        <span className={styles.todoBadgeApproval}>
                          Awaiting Approval
                        </span>
                        <span>{approval.step}</span>
                        <span>{approval.workflow_name}</span>
                        <span>
                          {new Date(approval.created_at).toLocaleString()}
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
