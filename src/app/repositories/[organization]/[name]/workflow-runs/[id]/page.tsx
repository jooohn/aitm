"use client";

import { useParams } from "next/navigation";
import WorkflowRunPage from "@/app/components/WorkflowRunPage";
import styles from "./page.module.css";

export default function WorkflowRunRoute() {
  const { id } = useParams<{ id: string }>();

  return (
    <main className={styles.page}>
      <WorkflowRunPage workflowRunId={id} />
    </main>
  );
}
