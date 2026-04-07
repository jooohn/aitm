"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import WorkflowKanbanBoard from "@/app/workflows/WorkflowKanbanBoard";
import { fetchRepositories, type Repository } from "@/lib/utils/api";
import styles from "./page.module.css";

export default function Home() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [repoError, setRepoError] = useState<string | null>(null);

  useEffect(() => {
    fetchRepositories()
      .then(setRepos)
      .catch((err) => {
        setRepoError(
          err instanceof Error ? err.message : "Failed to load repositories",
        );
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <section className={styles.paneSection}>
          <h2 className={styles.paneHeading}>Repositories</h2>
          {repoError && <p className={styles.error}>{repoError}</p>}
          {loading ? (
            <p className={styles.empty}>Loading…</p>
          ) : repos.length === 0 ? (
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
