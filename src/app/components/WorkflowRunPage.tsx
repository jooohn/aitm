"use client";

import { notFound } from "next/navigation";
import { useEffect, useState } from "react";
import WorkflowRunDetailView from "@/app/repositories/[organization]/[name]/workflow-runs/[id]/WorkflowRunDetail";
import { fetchWorkflowRun, type WorkflowRunDetail } from "@/lib/utils/api";

interface Props {
  workflowRunId: string;
  basePath?: string;
}

export default function WorkflowRunPage({ workflowRunId, basePath }: Props) {
  const [run, setRun] = useState<WorkflowRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFoundError, setNotFoundError] = useState(false);

  useEffect(() => {
    fetchWorkflowRun(workflowRunId)
      .then(setRun)
      .catch(() => setNotFoundError(true))
      .finally(() => setLoading(false));
  }, [workflowRunId]);

  if (loading) return null;
  if (notFoundError || !run) return notFound();

  return <WorkflowRunDetailView run={run} basePath={basePath} />;
}
