"use client";

import { notFound, useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import SessionDetail from "@/app/sessions/[id]/SessionDetail";
import { fetchSession, type Session } from "@/lib/utils/api";
import styles from "./page.module.css";

export default function SessionDrawerPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFoundError, setNotFoundError] = useState(false);
  const [closing, setClosing] = useState(false);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => router.back(), 200);
  }, [router]);

  useEffect(() => {
    fetchSession(sessionId)
      .then(setSession)
      .catch(() => setNotFoundError(true))
      .finally(() => setLoading(false));
  }, [sessionId]);

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
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className={styles.drawerBody}>
          <SessionDetail session={session} />
        </div>
      </aside>
    </div>
  );
}
