"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchWorkflowRun, type WorkflowRunDetail } from "@/lib/utils/api";
import { inferAlias } from "@/lib/utils/inferAlias";
import styles from "./page.module.css";
import WorkflowRunDetailView from "./WorkflowRunDetail";

export default function WorkflowRunPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<WorkflowRunDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWorkflowRun(id)
      .then(setRun)
      .catch(() => notFound())
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return null;
  if (!run) return notFound();

  const repoAlias = inferAlias(run.repository_path);
  const [organization, repoName] = repoAlias.split("/");
  const branch = run.worktree_branch;

  return (
    <main className={styles.page}>
      <nav className={styles.breadcrumb}>
        <Link href="/" className={styles.breadcrumbLink}>
          Repositories
        </Link>
        <span className={styles.breadcrumbSep}>/</span>
        {organization && repoName ? (
          <>
            <Link
              href={`/repositories/${organization}/${repoName}`}
              className={styles.breadcrumbLink}
            >
              {repoAlias}
            </Link>
            <span className={styles.breadcrumbSep}>/</span>
            <Link
              href={`/repositories/${organization}/${repoName}/worktrees/${branch}`}
              className={styles.breadcrumbLink}
            >
              {branch}
            </Link>
          </>
        ) : (
          <span>{repoAlias}</span>
        )}
        <span className={styles.breadcrumbSep}>/</span>
        <span className={styles.breadcrumbCurrent}>{id.slice(0, 8)}…</span>
      </nav>
      <WorkflowRunDetailView run={run} />
    </main>
  );
}
