"use client";

import { notFound, useParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import SessionDetail from "@/app/(main)/sessions/[id]/SessionDetail";
import CloseIcon from "@/app/components/icons/CloseIcon";
import { useSession } from "@/lib/hooks/swr";
import { isNotFoundError } from "@/lib/utils/api";
import styles from "./SessionDrawer.module.css";

export default function SessionDrawer() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const pathname = usePathname();
  const { data: session, error, isLoading: loading } = useSession(sessionId);
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState(false);

  const shouldShow = /\/sessions\/[^/]+$/.test(pathname);

  // Reset closed/closing state when the URL indicates the drawer should be open
  useEffect(() => {
    if (shouldShow) {
      setClosed(false);
      setClosing(false);
    }
  }, [shouldShow]);

  const handleClose = useCallback(() => {
    setClosing(true);
    const parentPath = pathname.replace(/\/sessions\/[^/]+$/, "");
    setTimeout(() => {
      setClosed(true);
      window.history.replaceState(null, "", parentPath);
    }, 200);
  }, [pathname]);

  if (closed) return null;
  if (!session && loading) return null;
  if (isNotFoundError(error)) return notFound();
  if (error) {
    return (
      <div className={styles.overlay}>
        <div className={styles.backdrop} onClick={handleClose} />
        <aside className={styles.drawer}>
          <div className={styles.drawerHeader}>
            <h2 className={styles.drawerTitle}>Session unavailable</h2>
            <button
              type="button"
              className={styles.closeButton}
              onClick={handleClose}
              aria-label="Close session drawer"
            >
              <CloseIcon />
            </button>
          </div>
          <div className={styles.drawerBody}>
            <p className={styles.error}>
              {error instanceof Error
                ? error.message
                : "Failed to load session"}
            </p>
          </div>
        </aside>
      </div>
    );
  }
  if (!session) return null;

  return (
    <div className={styles.overlay}>
      <div
        className={`${styles.backdrop} ${closing ? styles.backdropClosing : ""}`}
        onClick={handleClose}
      />
      <aside
        className={`${styles.drawer} ${closing ? styles.drawerClosing : ""}`}
      >
        <div className={styles.drawerHeader}>
          <h2 className={styles.drawerTitle}>
            {session.step_name ?? `Session ${session.id.slice(0, 8)}`}
          </h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={handleClose}
            aria-label="Close session drawer"
          >
            <CloseIcon />
          </button>
        </div>
        <div className={styles.drawerBody}>
          <SessionDetail session={session} />
        </div>
      </aside>
    </div>
  );
}
