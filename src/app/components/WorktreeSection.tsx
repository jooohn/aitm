"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  cleanMergedWorktrees,
  createWorktree,
  fetchWorktrees,
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
  const [cleaningMerged, setCleaningMerged] = useState(false);
  const [cleanMergedError, setCleanMergedError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
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
      {loadError && <p className={styles.error}>{loadError}</p>}

      {!loading && !loadError && (
        <ul className={styles.list}>
          {worktrees.map((w) => (
            <li key={w.branch || w.path}>
              <Link
                href={`/repositories/${organization}/${name}/worktrees/${w.branch}`}
                className={styles.item}
              >
                <span className={styles.branch}>{w.branch || "(bare)"}</span>
              </Link>
            </li>
          ))}
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
