"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  cleanMergedWorktrees,
  createWorktree,
  fetchWorktrees,
  removeWorktree,
  type Worktree,
} from "@/lib/utils/api";
import styles from "./WorktreeSection.module.css";

interface Props {
  organization: string;
  name: string;
}

export default function WorktreeSection({ organization, name }: Props) {
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [branch, setBranch] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [removingBranch, setRemovingBranch] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [cleaningMerged, setCleaningMerged] = useState(false);
  const [cleanMergedError, setCleanMergedError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    if (!showCreateModal) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setShowCreateModal(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showCreateModal]);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      setWorktrees(await fetchWorktrees(organization, name));
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load worktrees",
      );
    } finally {
      setLoading(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load only on mount
  useEffect(() => {
    load();
  }, []);

  async function handleCleanMerged() {
    setCleaningMerged(true);
    setCleanMergedError(null);
    try {
      await cleanMergedWorktrees(organization, name);
      await load();
    } catch (err) {
      setCleanMergedError(
        err instanceof Error ? err.message : "Failed to clean merged worktrees",
      );
    } finally {
      setCleaningMerged(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await createWorktree(organization, name, { branch });
      setBranch("");
      setShowCreateModal(false);
      await load();
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create worktree",
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleRemove(w: Worktree) {
    setRemovingBranch(w.branch);
    setRemoveError(null);
    try {
      await removeWorktree(organization, name, w.branch);
      await load();
    } catch (err) {
      setRemoveError(
        err instanceof Error ? err.message : "Failed to remove worktree",
      );
    } finally {
      setRemovingBranch(null);
    }
  }

  return (
    <section className={styles.section}>
      <div className={styles.headingRow}>
        <h2 className={styles.heading}>Worktrees</h2>
        <button
          type="button"
          className={styles.addButton}
          onClick={() => {
            setCreateError(null);
            setShowCreateModal(true);
          }}
          aria-label="New worktree"
          title="New worktree"
        >
          <svg
            viewBox="0 0 16 16"
            width="16"
            height="16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M7.75 2a.75.75 0 0 1 .75.75V7.25h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5V2.75A.75.75 0 0 1 7.75 2Z" />
          </svg>
        </button>
      </div>

      {loading && <p className={styles.status}>Loading…</p>}
      {loadError && <p className={styles.error}>{loadError}</p>}

      {!loading && !loadError && (
        <ul className={styles.list}>
          {worktrees.map((w) => {
            const isRemoving = removingBranch === w.branch;
            const removeTitle = w.is_main
              ? "Cannot remove main worktree"
              : isRemoving
                ? "Removing…"
                : "Remove worktree";
            return (
              <li key={w.branch || w.path} className={styles.item}>
                <div className={styles.info}>
                  <Link
                    href={`/repositories/${organization}/${name}/worktrees/${w.branch}`}
                    className={styles.branch}
                  >
                    {w.branch || "(bare)"}
                  </Link>
                </div>
                <button
                  type="button"
                  className={styles.removeButton}
                  disabled={w.is_main || isRemoving}
                  onClick={() => handleRemove(w)}
                  title={removeTitle}
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
              </li>
            );
          })}
        </ul>
      )}

      {removeError && <p className={styles.error}>{removeError}</p>}

      <button
        type="button"
        className={styles.cleanMergedButton}
        disabled={cleaningMerged || loading}
        onClick={handleCleanMerged}
      >
        {cleaningMerged ? "Cleaning up…" : "Cleanup merged worktrees"}
      </button>
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
