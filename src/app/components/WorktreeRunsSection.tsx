"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  cleanMergedWorktrees,
  createWorktree,
  fetchWorkflowRuns,
  fetchWorktrees,
  type WorkflowRun,
  type WorkflowRunStatus,
  type Worktree,
} from "@/lib/utils/api";
import {
  groupRunsByWorktree,
  type WorktreeGroup,
} from "@/lib/utils/groupRunsByWorktree";
import { timeAgo } from "@/lib/utils/timeAgo";
import styles from "./WorktreeRunsSection.module.css";

const INITIAL_VISIBLE_RUNS = 3;

const runStatusDotClass: Record<WorkflowRunStatus, string> = {
  running: styles["runStatusDot-running"],
  success: styles["runStatusDot-success"],
  failure: styles["runStatusDot-failure"],
};

const RUN_STATUS_LABELS: Record<WorkflowRunStatus, string> = {
  running: "Running",
  success: "Success",
  failure: "Failure",
};

interface Props {
  organization: string;
  name: string;
  repositoryPath: string;
  refreshKey?: number;
}

export default function WorktreeRunsSection({
  organization,
  name,
  repositoryPath,
  refreshKey,
}: Props) {
  const pathname = usePathname();
  const [groups, setGroups] = useState<WorktreeGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(
    new Set(),
  );
  const [initialExpandDone, setInitialExpandDone] = useState(false);
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

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [worktrees, runs] = await Promise.all([
        fetchWorktrees(organization, name),
        fetchWorkflowRuns(repositoryPath),
      ]);
      const grouped = groupRunsByWorktree(worktrees, runs);
      setGroups(grouped);

      // Set initial expansion: expand groups that have any runs
      if (!initialExpandDone) {
        const toExpand = new Set<string>();
        for (const group of grouped) {
          if (group.runs.length > 0) {
            toExpand.add(group.worktree?.branch ?? "__orphaned__");
          }
        }
        setExpandedBranches(toExpand);
        setInitialExpandDone(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load on mount and when refreshKey changes
  useEffect(() => {
    loadData();
  }, [refreshKey]);

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

  function toggleBranch(key: string) {
    setExpandedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await createWorktree(organization, name, { branch });
      setBranch("");
      setShowCreateModal(false);
      await loadData();
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
      await loadData();
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
            <svg
              viewBox="0 0 16 16"
              width="16"
              height="16"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM1.5 8a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Zm10 0a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Z" />
            </svg>
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

      {loading && <p className={styles.status}>Loading…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!loading && !error && (
        <ul className={styles.groupList}>
          {groups.map((group) => {
            const key = group.worktree?.branch ?? "__orphaned__";
            const isExpanded = expandedBranches.has(key);
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

            return (
              <li key={key} className={styles.group}>
                <div className={styles.groupHeader}>
                  <button
                    type="button"
                    className={`${styles.groupToggle} ${isWorktreeActive ? styles.groupToggleActive : ""}`}
                    onClick={() => toggleBranch(key)}
                    aria-expanded={isExpanded}
                    aria-label={label}
                  >
                    <svg
                      viewBox="0 0 16 16"
                      width="12"
                      height="12"
                      fill="currentColor"
                      className={`${styles.chevron} ${isExpanded ? styles.chevronExpanded : ""}`}
                      aria-hidden="true"
                    >
                      <path d="M6 12l4-4-4-4" />
                    </svg>
                    <span className={styles.groupLabel}>{label}</span>
                  </button>
                </div>
                <ul className={styles.runsList} hidden={!isExpanded}>
                  {visibleRuns.map((run) => {
                    const runHref = `/repositories/${organization}/${name}/workflow-runs/${run.id}`;
                    const isActive = pathname.startsWith(runHref);
                    return (
                      <li key={run.id}>
                        <Link
                          href={runHref}
                          className={`${styles.runItem} ${isActive ? styles.runItemActive : ""}`}
                        >
                          <span
                            className={`${styles.runStatusDot} ${runStatusDotClass[run.status]}`}
                            title={RUN_STATUS_LABELS[run.status]}
                          />
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
