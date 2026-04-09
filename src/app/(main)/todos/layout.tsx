"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import StatusDot from "@/app/components/StatusDot";
import { useAllWorkflowRuns } from "@/lib/hooks/swr";
import { timeAgo } from "@/lib/utils/timeAgo";
import styles from "./page.module.css";

export default function TodosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    data: items,
    error,
    isLoading: loading,
  } = useAllWorkflowRuns("awaiting");

  useEffect(() => {
    if (pathname === "/todos" && items && items.length > 0) {
      router.replace(`/todos/${items[0].id}`);
    }
  }, [pathname, items, router]);

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
            <p className={styles.error}>
              {error instanceof Error ? error.message : "Failed to load todos"}
            </p>
          ) : !items || items.length === 0 ? (
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
                        <StatusDot variant="awaiting" />
                        {run.worktree_branch}
                      </span>
                      <span className={styles.sessionSecondary}>
                        <span>
                          {run.organization}/{run.name}
                        </span>
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
