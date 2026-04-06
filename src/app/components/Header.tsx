"use client";

import Link from "next/link";
import ListIcon from "@/app/components/icons/ListIcon";
import { useAwaitingInputCount } from "@/lib/hooks/useAwaitingInputCount";
import styles from "./Header.module.css";

export default function Header() {
  const { count } = useAwaitingInputCount();

  return (
    <header
      className={`${styles.header} ${styles.stickyHeader} ${styles.backdropHeader}`}
    >
      <Link href="/" className={styles.logo}>
        aitm
      </Link>
      <div className={styles.actions}>
        <span className={styles.iconButtonWrapper}>
          <Link
            href="/todos"
            className={styles.iconButton}
            aria-label="Open todos"
          >
            <ListIcon className={styles.icon} />
          </Link>
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
