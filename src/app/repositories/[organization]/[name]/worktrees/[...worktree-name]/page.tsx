"use client";

import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import SessionSection from "@/app/components/SessionSection";
import WorkflowBreadcrumb from "@/app/components/WorkflowBreadcrumb";
import WorkflowSection from "@/app/components/WorkflowSection";
import {
  fetchRepository,
  fetchWorktrees,
  type RepositoryDetail,
  type Worktree,
} from "@/lib/utils/api";
import styles from "./page.module.css";

export default function WorktreePage() {
  const {
    organization,
    name,
    "worktree-name": worktreeNameSegments,
  } = useParams<{
    organization: string;
    name: string;
    "worktree-name": string[];
  }>();
  const branch = worktreeNameSegments.join("/");

  const [repo, setRepo] = useState<RepositoryDetail | null>(null);
  const [worktree, setWorktree] = useState<Worktree | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchRepository(organization, name),
      fetchWorktrees(organization, name),
    ])
      .then(([r, worktrees]) => {
        setRepo(r);
        const wt = worktrees.find((w) => w.branch === branch);
        if (!wt) {
          notFound();
          return;
        }
        setWorktree(wt);
      })
      .catch(() => notFound())
      .finally(() => setLoading(false));
  }, [organization, name, branch]);

  if (loading) return null;
  if (!repo || !worktree) return notFound();

  return (
    <main className={styles.page}>
      <WorkflowBreadcrumb repository={{ organization, name }} branch={branch} />
      <h1 className={styles.heading}>{branch || "(bare)"}</h1>
      <dl className={styles.details}>
        <div className={styles.row}>
          <dt className={styles.label}>Path</dt>
          <dd className={styles.value}>{worktree.path}</dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>HEAD</dt>
          <dd className={styles.value}>{worktree.head}</dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>Main</dt>
          <dd className={styles.value}>{worktree.is_main ? "Yes" : "No"}</dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>Bare</dt>
          <dd className={styles.value}>{worktree.is_bare ? "Yes" : "No"}</dd>
        </div>
      </dl>
      <WorkflowSection repositoryPath={repo.path} branch={branch} />
      <SessionSection repositoryPath={repo.path} branch={branch} />
    </main>
  );
}
