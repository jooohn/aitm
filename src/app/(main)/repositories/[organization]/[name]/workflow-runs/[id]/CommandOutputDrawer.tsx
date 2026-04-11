"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import styles from "@/app/(main)/sessions/SessionDrawer.module.css";
import CloseIcon from "@/app/components/icons/CloseIcon";

interface CommandOutputDrawerProps {
  filename: string;
  content: string;
}

export default function CommandOutputDrawer({
  filename,
  content,
}: CommandOutputDrawerProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState(false);

  const shouldShow = /\/command-outputs\/[^/]+$/.test(pathname);

  useEffect(() => {
    if (shouldShow) {
      setClosed(false);
      setClosing(false);
    }
  }, [shouldShow]);

  const handleClose = useCallback(() => {
    setClosing(true);
    const parentPath = pathname.replace(/\/command-outputs\/[^/]+$/, "");
    setTimeout(() => {
      setClosed(true);
      router.replace(parentPath);
    }, 200);
  }, [pathname, router]);

  if (closed) return null;

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
          <h2 className={styles.drawerTitle}>{filename}</h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={handleClose}
            aria-label="Close command output drawer"
          >
            <CloseIcon />
          </button>
        </div>
        <div className={styles.drawerBody}>
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              fontFamily: "var(--font-geist-mono), monospace",
            }}
          >
            {content}
          </pre>
        </div>
      </aside>
    </div>
  );
}
