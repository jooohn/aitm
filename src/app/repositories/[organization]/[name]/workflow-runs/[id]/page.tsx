"use client";

import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchWorkflowRun, type WorkflowRunDetail } from "@/lib/utils/api";
import styles from "./page.module.css";
import WorkflowRunDetailView from "./WorkflowRunDetail";

export default function WorkflowRunPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<WorkflowRunDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWorkflowRun(id)
      .then(setRun)
      .catch(() => notFound())
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return null;
  if (!run) return notFound();

  return (
    <main className={styles.page}>
      <WorkflowRunDetailView run={run} />
    </main>
  );
}
