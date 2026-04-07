"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import WorkflowRunPage from "@/app/repositories/[organization]/[name]/workflow-runs/WorkflowRunPage";
import { fetchWorkflowRun, type WorkflowRunDetail } from "@/lib/utils/api";

export default function TodoDetailRoute() {
  const { workflowRunId } = useParams<{ workflowRunId: string }>();
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [prevRunId, setPrevRunId] = useState(workflowRunId);

  if (prevRunId !== workflowRunId) {
    setPrevRunId(workflowRunId);
    setChecked(false);
  }

  useEffect(() => {
    let cancelled = false;
    fetchWorkflowRun(workflowRunId)
      .then((run: WorkflowRunDetail) => {
        if (cancelled) return;
        if (run.status === "awaiting") {
          const awaitingStep = run.step_executions.find(
            (s) => s.status === "awaiting" && s.session_id,
          );
          if (awaitingStep) {
            router.replace(
              `/todos/${workflowRunId}/sessions/${awaitingStep.session_id}`,
            );
            return;
          }
        }
        setChecked(true);
      })
      .catch(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [workflowRunId, router]);

  if (!checked) return null;

  return (
    <WorkflowRunPage
      workflowRunId={workflowRunId}
      basePath={`/todos/${workflowRunId}`}
    />
  );
}
