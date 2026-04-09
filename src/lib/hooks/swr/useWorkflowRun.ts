import useSWR from "swr";
import { fetchWorkflowRun, type WorkflowRunDetail } from "@/lib/utils/api";
import { swrKeys } from "./keys";

export function useWorkflowRun(
  id: string | null,
  options?: { fallbackData?: WorkflowRunDetail },
) {
  return useSWR<WorkflowRunDetail>(
    id ? swrKeys.workflowRun(id) : null,
    () => fetchWorkflowRun(id!),
    {
      fallbackData: options?.fallbackData,
    },
  );
}
