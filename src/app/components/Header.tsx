"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "./Header.module.css";
import RunWorkflowModal from "./RunWorkflowModal";

export default function Header() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <header className={styles.header}>
        <Link href="/" className={styles.logo}>
          aitm
        </Link>
        <button
          type="button"
          className={styles.runButton}
          onClick={() => setModalOpen(true)}
        >
          Run Workflow
        </button>
      </header>
      {modalOpen && <RunWorkflowModal onClose={() => setModalOpen(false)} />}
    </>
  );
}
