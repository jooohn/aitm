"use client";

import { useEffect, useState } from "react";
import { fetchRepositories, type Repository } from "@/lib/utils/api";
import ActiveWorkflowsSection from "./components/ActiveWorkflowsSection";
import HomeQuickLaunchSection from "./components/HomeQuickLaunchSection";
import RepositoryRow from "./components/RepositoryRow";
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
    <main className={styles.page}>
      <ActiveWorkflowsSection />
      <HomeQuickLaunchSection />
      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>Repositories</h2>
        {repoError && <div className={styles.errorBanner}>{repoError}</div>}
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
      </section>
    </main>
  );
}
