"use client";

import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import WorkflowBreadcrumb from "@/app/components/WorkflowBreadcrumb";
import { fetchWorkflowRun, type WorkflowRunDetail } from "@/lib/utils/api";
import { inferAlias } from "@/lib/utils/inferAlias";
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

  const repoAlias = inferAlias(run.repository_path);
  const [organization, repoName] = repoAlias.split("/");
  const branch = run.worktree_branch;

  return (
    <main className={styles.page}>
      <WorkflowBreadcrumb
        repository={{ organization, name: repoName }}
        branch={branch}
        workflowRun={{ id: run.id, name: run.workflow_name }}
      />
      <WorkflowRunDetailView run={run} />
    </main>
  );
}
