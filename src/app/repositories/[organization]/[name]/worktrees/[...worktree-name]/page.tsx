"use client";

import { notFound, useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import PrChip, { extractPrInfos } from "@/app/components/PrChip";
import WorkflowKanbanBoard from "@/app/components/WorkflowKanbanBoard";
import {
  fetchRepository,
  fetchWorkflowRuns,
  fetchWorktrees,
  type RepositoryDetail,
  removeWorktree,
  type WorkflowRun,
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
  const router = useRouter();

  const [repo, setRepo] = useState<RepositoryDetail | null>(null);
  const [worktree, setWorktree] = useState<Worktree | null>(null);
  const [loading, setLoading] = useState(true);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[]>([]);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

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
        fetchWorkflowRuns(r.path, branch).then(setWorkflowRuns);
      })
      .catch(() => notFound())
      .finally(() => setLoading(false));
  }, [organization, name, branch]);

  async function handleRemove() {
    setRemoving(true);
    setRemoveError(null);
    try {
      await removeWorktree(organization, name, branch);
      router.push(`/repositories/${organization}/${name}`);
    } catch (err) {
      setRemoveError(
        err instanceof Error ? err.message : "Failed to remove worktree",
      );
      setRemoving(false);
    }
  }

  if (loading) return null;
  if (!repo || !worktree) return notFound();

  const prs = extractPrInfos(workflowRuns);

  return (
    <main className={styles.page}>
      <div className={styles.headerBlock}>
        <div className={styles.headingRow}>
          <h1 className={styles.heading}>{branch || "(bare)"}</h1>
          {!worktree.is_main && (
            <button
              type="button"
              className={styles.removeButton}
              disabled={removing}
              onClick={handleRemove}
              title={removing ? "Removing…" : "Remove worktree"}
              aria-label="Remove worktree"
            >
              <svg
                viewBox="0 0 16 16"
                width="16"
                height="16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M6.5 1.75a.25.25 0 0 1 .25-.25h2.5a.25.25 0 0 1 .25.25V3h-3V1.75Zm4.5 0V3h2.25a.75.75 0 0 1 0 1.5h-.54l-.7 9.83a1.75 1.75 0 0 1-1.747 1.67H5.737a1.75 1.75 0 0 1-1.747-1.67L3.29 4.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.794 4.5l.692 9.72a.25.25 0 0 0 .249.239h4.53a.25.25 0 0 0 .25-.238l.692-9.721H4.794Z" />
              </svg>
            </button>
          )}
        </div>
        {prs.length > 0 && (
          <div className={styles.prChips}>
            {prs.map((pr) => (
              <PrChip key={pr.url} pr={pr} />
            ))}
          </div>
        )}
      </div>
      {removeError && <p className={styles.error}>{removeError}</p>}
      <WorkflowKanbanBoard
        repositoryPath={repo.path}
        activeWorktreeBranches={[branch]}
      />
    </main>
  );
}
