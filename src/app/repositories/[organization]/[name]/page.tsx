"use client";

import { notFound, useParams } from "next/navigation";
import WorkflowKanbanBoard from "@/app/workflows/WorkflowKanbanBoard";
import { useRepository, useWorktrees } from "@/lib/hooks/swr";
import styles from "./page.module.css";

export default function RepositoryPage() {
  const { organization, name } = useParams<{
    organization: string;
    name: string;
  }>();
  const {
    data: repo,
    error,
    isLoading: loading,
  } = useRepository(organization, name);
  const { data: worktrees } = useWorktrees(organization, name);

  if (loading) return null;
  if (error || !repo) return notFound();

  const activeWorktreeBranches = worktrees
    ? worktrees.map((w) => w.branch).filter(Boolean)
    : null;

  return (
    <main className={styles.page}>
      <div className={styles.contentPane}>
        <WorkflowKanbanBoard
          repositoryPath={repo.path}
          activeWorktreeBranches={activeWorktreeBranches}
        />
      </div>
    </main>
  );
}
