"use client";

import { useParams } from "next/navigation";
import WorkflowRunPage from "@/app/repositories/[organization]/[name]/workflow-runs/WorkflowRunPage";

export default function TodoDetailRoute() {
  const { workflowRunId } = useParams<{ workflowRunId: string }>();

  return (
    <WorkflowRunPage
      workflowRunId={workflowRunId}
      basePath={`/todos/${workflowRunId}`}
    />
  );
}
