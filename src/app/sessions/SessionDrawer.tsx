"use client";

import { notFound, useParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import CloseIcon from "@/app/components/icons/CloseIcon";
import SessionDetail from "@/app/sessions/[id]/SessionDetail";
import { fetchSession, type Session } from "@/lib/utils/api";
import styles from "./SessionDrawer.module.css";

export default function SessionDrawer() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFoundError, setNotFoundError] = useState(false);
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

  useEffect(() => {
    fetchSession(sessionId)
      .then(setSession)
      .catch(() => setNotFoundError(true))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (closed) return null;
  if (loading) return null;
  if (notFoundError || !session) return notFound();

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
