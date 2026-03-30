"use client";

import { useEffect, useState } from "react";
import { fetchRepositories, type Repository } from "@/lib/utils/api";
import RepositoryRow from "./components/RepositoryRow";
import styles from "./page.module.css";

export default function Home() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);

  useEffect(() => {
    fetchRepositories()
      .then(setRepos)
      .catch((err) => {
        setGlobalError(
          err instanceof Error ? err.message : "Failed to load repositories",
        );
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>Repositories</h1>
      {globalError && <div className={styles.errorBanner}>{globalError}</div>}
      {loading ? (
        <p className={styles.empty}>Loading…</p>
      ) : repos.length === 0 ? (
        <p className={styles.empty}>
          No repositories configured. Add entries to{" "}
          <code>~/.aitm/config.yaml</code>.
        </p>
      ) : (
        <ul className={styles.list}>
          {repos.map((repo) => (
            <RepositoryRow key={repo.path} repo={repo} />
          ))}
        </ul>
      )}
    </main>
  );
}
