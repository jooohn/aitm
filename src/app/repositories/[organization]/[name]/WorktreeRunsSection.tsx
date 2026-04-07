"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { mutate } from "swr";
import EllipsisIcon from "@/app/components/icons/EllipsisIcon";
import PrChip, { extractPrInfos } from "@/app/components/PrChip";
import StatusDot from "@/app/components/StatusDot";
import { swrKeys } from "@/lib/hooks/swr";
import {
  cleanMergedWorktrees,
  createWorktree,
  type WorkflowRun,
  type Worktree,
} from "@/lib/utils/api";
import { groupRunsByWorktree } from "@/lib/utils/groupRunsByWorktree";
import { timeAgo } from "@/lib/utils/timeAgo";
import styles from "./WorktreeRunsSection.module.css";

const INITIAL_VISIBLE_RUNS = 3;

interface Props {
  organization: string;
  name: string;
  worktrees: Worktree[];
  runs: WorkflowRun[];
  loading: boolean;
  hasLoadedOnce: boolean;
  error: string | null;
}

export default function WorktreeRunsSection({
  organization,
  name,
  worktrees,
  runs,
  loading,
  hasLoadedOnce,
  error,
}: Props) {
  const pathname = usePathname();
  const groups = useMemo(
    () => groupRunsByWorktree(worktrees, runs),
    [worktrees, runs],
  );
  const [showAllRunsBranches, setShowAllRunsBranches] = useState<Set<string>>(
    new Set(),
  );

  // Worktree management state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [branch, setBranch] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [cleaningMerged, setCleaningMerged] = useState(false);
  const [cleanMergedError, setCleanMergedError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showCreateModal) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setShowCreateModal(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showCreateModal]);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await createWorktree(organization, name, { branch });
      setBranch("");
      setShowCreateModal(false);
      await mutate(swrKeys.worktrees(organization, name));
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create worktree",
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleCleanMerged() {
    setCleaningMerged(true);
    setCleanMergedError(null);
    try {
      await cleanMergedWorktrees(organization, name);
      await mutate(swrKeys.worktrees(organization, name));
    } catch (err) {
      setCleanMergedError(
        err instanceof Error ? err.message : "Failed to clean merged worktrees",
      );
    } finally {
      setCleaningMerged(false);
    }
  }

  return (
    <section className={styles.section}>
      <div className={styles.headingRow}>
        <h2 className={styles.heading}>Worktrees</h2>
        <div className={styles.menuWrapper} ref={menuRef}>
          <button
            type="button"
            className={styles.menuButton}
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Worktree actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="Worktree actions"
          >
            <EllipsisIcon />
          </button>
          {menuOpen && (
            <div className={styles.menu} role="menu">
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => {
                  setMenuOpen(false);
                  setCreateError(null);
                  setShowCreateModal(true);
                }}
              >
                Add new worktree
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                disabled={cleaningMerged || loading}
                onClick={() => {
                  setMenuOpen(false);
                  handleCleanMerged();
                }}
              >
                {cleaningMerged ? "Cleaning up…" : "Cleanup merged worktrees"}
              </button>
            </div>
          )}
        </div>
      </div>

      {!hasLoadedOnce && loading && <p className={styles.status}>Loading…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {(hasLoadedOnce || !loading) && !error && (
        <ul className={styles.groupList}>
          {groups.map((group) => {
            const key = group.worktree?.branch ?? "__orphaned__";
            const label = group.worktree?.branch ?? "Archived";
            const isWorktreeActive = group.worktree
              ? pathname.startsWith(
                  `/repositories/${organization}/${name}/worktrees/${group.worktree.branch}`,
                )
              : false;

            const showAll = showAllRunsBranches.has(key);
            const visibleRuns = showAll
              ? group.runs
              : group.runs.slice(0, INITIAL_VISIBLE_RUNS);
            const hiddenCount = group.runs.length - INITIAL_VISIBLE_RUNS;

            const prs = extractPrInfos(group.runs);

            return (
              <li key={key} className={styles.group}>
                <div className={styles.groupHeader}>
                  {group.worktree ? (
                    <Link
                      href={`/repositories/${organization}/${name}/worktrees/${group.worktree.branch}`}
                      className={`${styles.groupToggle} ${isWorktreeActive ? styles.groupToggleActive : ""}`}
                    >
                      <span className={styles.groupLabel}>{label}</span>
                    </Link>
                  ) : (
                    <span className={styles.groupToggle}>
                      <span className={styles.groupLabel}>{label}</span>
                    </span>
                  )}
                  {prs.map((pr) => (
                    <PrChip key={pr.url} pr={pr} />
                  ))}
                </div>
                <ul className={styles.runsList}>
                  {visibleRuns.map((run) => {
                    const runHref = `/repositories/${organization}/${name}/workflow-runs/${run.id}`;
                    const isActive = pathname.startsWith(runHref);
                    return (
                      <li key={run.id}>
                        <Link
                          href={runHref}
                          className={`${styles.runItem} ${isActive ? styles.runItemActive : ""}`}
                        >
                          <StatusDot variant={run.status} />
                          <span className={styles.runInfo}>
                            <span className={styles.runWorkflow}>
                              {run.workflow_name}
                            </span>
                            {group.worktree === null && (
                              <span className={styles.runBranch}>
                                {run.worktree_branch}
                              </span>
                            )}
                          </span>
                          <span className={styles.runTime}>
                            {timeAgo(run.created_at)}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                  {!showAll && hiddenCount > 0 && (
                    <li>
                      <button
                        type="button"
                        className={styles.showAllButton}
                        onClick={() =>
                          setShowAllRunsBranches((prev) => {
                            const next = new Set(prev);
                            next.add(key);
                            return next;
                          })
                        }
                      >
                        Show all
                      </button>
                    </li>
                  )}
                </ul>
              </li>
            );
          })}
        </ul>
      )}

      {cleanMergedError && <p className={styles.error}>{cleanMergedError}</p>}

      {showCreateModal && (
        <div
          className={styles.overlay}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCreateModal(false);
          }}
        >
          <div className={styles.panel}>
            <div className={styles.titleRow}>
              <h3 className={styles.title}>New worktree</h3>
              <button
                type="button"
                className={styles.closeButton}
                onClick={() => setShowCreateModal(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreate} className={styles.form}>
              <input
                type="text"
                className={styles.input}
                placeholder="branch name"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                disabled={creating}
                required
                autoFocus
              />
              <button
                type="submit"
                className={styles.createButton}
                disabled={creating || !branch.trim()}
              >
                {creating ? "Creating…" : "Create"}
              </button>
            </form>
            {createError && <p className={styles.error}>{createError}</p>}
          </div>
        </div>
      )}
    </section>
  );
}
