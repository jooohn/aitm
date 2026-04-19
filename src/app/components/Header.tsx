"use client";

import Link from "next/link";
import { useState } from "react";
import IconButton from "@/app/components/IconButton";
import ListIcon from "@/app/components/icons/ListIcon";
import SyncIcon from "@/app/components/icons/SyncIcon";
import { useAlert } from "@/lib/alert/AlertContext";
import { useAwaitingInputCount } from "@/lib/hooks/useAwaitingInputCount";
import { useHouseKeepingSyncing } from "@/lib/hooks/useHouseKeepingSyncing";
import { runHouseKeeping } from "@/lib/utils/api";
import styles from "./Header.module.css";

export default function Header() {
  const { pushAlert } = useAlert();
  const { count } = useAwaitingInputCount();
  const syncing = useHouseKeepingSyncing();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isSyncing = syncing || isSubmitting;

  async function handleRunHouseKeeping(): Promise<void> {
    if (isSyncing) {
      return;
    }

    setIsSubmitting(true);
    try {
      await runHouseKeeping();
    } catch {
      pushAlert({
        title: "Sync failed",
        message: "Failed to run house-keeping sync.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <header
      className={`${styles.header} ${styles.stickyHeader} ${styles.backdropHeader}`}
    >
      <Link href="/" className={styles.logo}>
        aitm
      </Link>
      <div className={styles.actions}>
        <IconButton
          aria-label="Run house-keeping sync"
          title="Run house-keeping sync"
          disabled={isSyncing}
          onClick={() => {
            void handleRunHouseKeeping();
          }}
        >
          <SyncIcon
            className={`${styles.icon} ${isSyncing ? styles.syncingIcon : ""}`}
          />
        </IconButton>
        <span className={styles.iconButtonWrapper}>
          <IconButton href="/todos" aria-label="Open todos">
            <ListIcon className={styles.icon} />
          </IconButton>
          {count > 0 && (
            <span
              role="status"
              className={styles.todosBadge}
              data-testid="todos-badge"
              aria-label={`${count} todos awaiting input`}
            />
          )}
        </span>
      </div>
    </header>
  );
}
