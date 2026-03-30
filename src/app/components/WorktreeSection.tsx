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
          className={styles.cleanMergedButton}
          disabled={cleaningMerged || loading}
          onClick={handleCleanMerged}
        >
          {cleaningMerged ? "Removing…" : "Remove merged"}
        </button>
      </div>
      {cleanMergedError && <p className={styles.error}>{cleanMergedError}</p>}

      {loading && <p className={styles.status}>Loading…</p>}
      {loadError && <p className={styles.error}>{loadError}</p>}

      {!loading && !loadError && (
        <ul className={styles.list}>
          {worktrees.map((w) => (
            <li key={w.branch || w.path} className={styles.item}>
              <div className={styles.info}>
                <Link
                  href={`/repositories/${organization}/${name}/worktrees/${w.branch}`}
                  className={styles.branch}
                >
                  {w.branch || "(bare)"}
                </Link>
                <span className={styles.path}>{w.path}</span>
                <span className={styles.head}>{w.head}</span>
              </div>
              <button
                type="button"
                className={styles.removeButton}
                disabled={w.is_main || removingBranch === w.branch}
                onClick={() => handleRemove(w)}
                title={w.is_main ? "Cannot remove main worktree" : undefined}
              >
                {removingBranch === w.branch ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {removeError && <p className={styles.error}>{removeError}</p>}

      <form onSubmit={handleCreate} className={styles.form}>
        <input
          type="text"
          className={styles.input}
          placeholder="branch name"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          disabled={creating}
          required
        />
        <button
          type="submit"
          className={styles.createButton}
          disabled={creating || !branch.trim()}
        >
          {creating ? "Creating…" : "New worktree"}
        </button>
      </form>
      {createError && <p className={styles.error}>{createError}</p>}
    </section>
  );
}
