"use client";

import Link from "next/link";
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
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              className={styles.icon}
            >
              <path
                d="M6 5.75h8M6 10h8M6 14.25h5M3.75 5.75h.5M3.75 10h.5M3.75 14.25h.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
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
