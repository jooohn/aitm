"use client";

import Link from "next/link";
import WorkflowKanbanBoard from "@/app/workflows/WorkflowKanbanBoard";
import { useRepositories } from "@/lib/hooks/swr";
import styles from "./page.module.css";

export default function Home() {
  const {
    data: repos,
    error: repoError,
    isLoading: loading,
  } = useRepositories();

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <section className={styles.paneSection}>
          <h2 className={styles.paneHeading}>Repositories</h2>
          {repoError && (
            <p className={styles.error}>
              {repoError instanceof Error
                ? repoError.message
                : "Failed to load repositories"}
            </p>
          )}
          {loading ? (
            <p className={styles.empty}>Loading…</p>
          ) : !repos || repos.length === 0 ? (
            <p className={styles.empty}>
              No repositories configured. Add entries to{" "}
              <code>~/.aitm/config.yaml</code>.
            </p>
          ) : (
            <ul className={styles.repoList}>
              {repos.map((repo) => (
                <li key={repo.path}>
                  <Link
                    href={`/repositories/${repo.alias}`}
                    className={styles.repoLink}
                  >
                    {repo.alias}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
      <main className={styles.content}>
        <WorkflowKanbanBoard activeWorktreeBranches={null} />
      </main>
    </div>
  );
}
