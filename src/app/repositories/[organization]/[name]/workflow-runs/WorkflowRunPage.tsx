"use client";

import { notFound, usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import WorkflowRunDetailView from "@/app/repositories/[organization]/[name]/workflow-runs/[id]/WorkflowRunDetail";
import { useWorkflowRun } from "@/lib/hooks/swr";
import type { WorkflowRunDetail } from "@/lib/utils/api";

interface Props {
  workflowRunId: string;
  basePath?: string;
}

export default function WorkflowRunPage({ workflowRunId, basePath }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    data: run,
    error,
    isLoading: loading,
  } = useWorkflowRun(workflowRunId);
  const [openedAwaitingSessionRunOnLoad, setOpenedAwaitingSessionRunOnLoad] =
    useState<WorkflowRunDetail | null>(null);

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
  }, [pathname, router, run, openedAwaitingSessionRunOnLoad]);

  if (loading) return null;
  if (error || !run) return notFound();

  return <WorkflowRunDetailView run={run} basePath={basePath} />;
}
