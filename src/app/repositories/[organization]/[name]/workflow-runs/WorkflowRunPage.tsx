"use client";

import { notFound, usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import WorkflowRunDetailView from "@/app/repositories/[organization]/[name]/workflow-runs/[id]/WorkflowRunDetail";
import { useNotificationStream } from "@/lib/hooks/useNotificationStream";
import { fetchWorkflowRun, type WorkflowRunDetail } from "@/lib/utils/api";

interface Props {
  workflowRunId: string;
  basePath?: string;
}

export default function WorkflowRunPage({ workflowRunId, basePath }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [run, setRun] = useState<WorkflowRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFoundError, setNotFoundError] = useState(false);
  const [openedAwaitingSessionRunOnLoad, setOpenedAwaitingSessionRunOnLoad] =
    useState<WorkflowRunDetail | null>(null);

  useNotificationStream(() => {
    setLoading(true);
    setNotFoundError(false);
    void fetchWorkflowRun(workflowRunId)
      .then(setRun)
      .catch(() => setNotFoundError(true))
      .finally(() => setLoading(false));
  });

  useEffect(() => {
    setLoading(true);
    setNotFoundError(false);
    void fetchWorkflowRun(workflowRunId)
      .then(setRun)
      .catch(() => setNotFoundError(true))
      .finally(() => setLoading(false));
  }, [workflowRunId]);

  useEffect(() => {
    if (
      run &&
      run !== openedAwaitingSessionRunOnLoad &&
      pathname.match(/^\/todos\/[0-9a-z-]+$/)
    ) {
      const sessionId = run.step_executions.find(
        (se) => se.status === "awaiting",
      )?.session_id;
      if (sessionId) {
        setOpenedAwaitingSessionRunOnLoad(run);
        router.replace(`${pathname}/sessions/${sessionId}`);
      }
    }
  }, [
    pathname,
    router,
    run,
    openedAwaitingSessionRunOnLoad,
    setOpenedAwaitingSessionRunOnLoad,
  ]);

  if (loading) return null;
  if (notFoundError || !run) return notFound();

  return <WorkflowRunDetailView run={run} basePath={basePath} />;
}
