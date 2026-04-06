"use client";

import { notFound } from "next/navigation";
import { useEffect, useState } from "react";
import WorkflowRunDetailView from "@/app/repositories/[organization]/[name]/workflow-runs/[id]/WorkflowRunDetail";
import { useNotificationStream } from "@/lib/hooks/useNotificationStream";
import { fetchWorkflowRun, type WorkflowRunDetail } from "@/lib/utils/api";

interface Props {
  workflowRunId: string;
  basePath?: string;
}

export default function WorkflowRunPage({ workflowRunId, basePath }: Props) {
  const [run, setRun] = useState<WorkflowRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFoundError, setNotFoundError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useNotificationStream(() => setRefreshKey((k) => k + 1));

  useEffect(() => {
    setNotFoundError(false);
    fetchWorkflowRun(workflowRunId)
      .then(setRun)
      .catch(() => setNotFoundError(true))
      .finally(() => setLoading(false));
  }, [workflowRunId, refreshKey]);

  if (loading) return null;
  if (notFoundError || !run) return notFound();

  return <WorkflowRunDetailView run={run} basePath={basePath} />;
}
