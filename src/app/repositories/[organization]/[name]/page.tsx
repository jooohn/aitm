"use client";

import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import WorkflowKanbanBoard from "@/app/components/WorkflowKanbanBoard";
import {
  fetchRepository,
  fetchWorktrees,
  type RepositoryDetail,
} from "@/lib/utils/api";
import styles from "./page.module.css";

export default function RepositoryPage() {
  const { organization, name } = useParams<{
    organization: string;
    name: string;
  }>();
  const [repo, setRepo] = useState<RepositoryDetail | null>(null);
  const [activeWorktreeBranches, setActiveWorktreeBranches] = useState<
    string[] | null
  >(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchRepository(organization, name),
      fetchWorktrees(organization, name).catch(() => null),
    ])
      .then(([r, worktrees]) => {
        setRepo(r);
        if (worktrees) {
          setActiveWorktreeBranches(
            worktrees.map((w) => w.branch).filter(Boolean),
          );
        }
      })
      .catch(() => notFound())
      .finally(() => setLoading(false));
  }, [organization, name]);

  if (loading) return null;
  if (!repo) return notFound();

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
