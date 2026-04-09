"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { mutate } from "swr";
import EllipsisIcon from "@/app/components/icons/EllipsisIcon";
import { swrKeys, useWorktrees } from "@/lib/hooks/swr";
import { cleanMergedWorktrees, createWorktree } from "@/lib/utils/api";
import styles from "./WorktreeSection.module.css";

interface Props {
  organization: string;
  name: string;
}

export default function WorktreeSection({ organization, name }: Props) {
  const pathname = usePathname();
  const {
    data: worktrees,
    error: loadError,
    isLoading,
  } = useWorktrees(organization, name);
  const hasLoadedOnce = !!worktrees || !!loadError;
  const loading = isLoading;

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
      {loadError && (
        <p className={styles.error}>
          {loadError instanceof Error
            ? loadError.message
            : "Failed to load worktrees"}
        </p>
      )}

      {(hasLoadedOnce || !loading) && !loadError && worktrees && (
        <ul className={styles.list}>
          {worktrees.map((w) => {
            const wtHref = `/repositories/${organization}/${name}/worktrees/${w.branch}`;
            const isActive = pathname.startsWith(wtHref);
            return (
              <li key={w.branch || w.path}>
                <Link
                  href={wtHref}
                  className={`${styles.item} ${isActive ? styles.itemActive : ""}`}
                >
                  <span className={styles.branch}>{w.branch || "(bare)"}</span>
                </Link>
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
