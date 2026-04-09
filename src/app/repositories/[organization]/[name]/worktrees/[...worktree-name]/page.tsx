"use client";

import { notFound, useParams, useRouter } from "next/navigation";
import { useState } from "react";
import TrashIcon from "@/app/components/icons/TrashIcon";
import PrChip, { extractPrInfos } from "@/app/components/PrChip";
import WorkflowKanbanBoard from "@/app/workflows/WorkflowKanbanBoard";
import { useRepository, useWorkflowRuns, useWorktrees } from "@/lib/hooks/swr";
import { isNotFoundError, removeWorktree } from "@/lib/utils/api";
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

  const {
    data: repo,
    error: repoError,
    isLoading: repoLoading,
  } = useRepository(organization, name);
  const {
    data: worktrees,
    error: worktreesError,
    isLoading: worktreesLoading,
  } = useWorktrees(organization, name);
  const { data: workflowRuns } = useWorkflowRuns(organization, name, branch);

  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const loading = repoLoading || worktreesLoading;
  const worktree = worktrees?.find((w) => w.branch === branch);

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

  if ((!repo || !worktrees) && loading) return null;
  if (isNotFoundError(repoError)) return notFound();
  if (repoError || worktreesError) {
    const error = repoError ?? worktreesError;
    return (
      <main className={styles.page}>
        <p className={styles.error}>
          {error instanceof Error ? error.message : "Failed to load worktree"}
        </p>
      </main>
    );
  }
  if (!repo) return null;
  if (worktrees && !worktree) return notFound();
  if (!worktree) return null;

  const prs = extractPrInfos(workflowRuns ?? []);

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
              <TrashIcon />
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
        organization={organization}
        name={name}
        activeWorktreeBranches={[branch]}
      />
    </main>
  );
}
