import useSWR from "swr";
import {
  fetchWorkflowRun,
  type WorkflowRunDetail,
  type WorkflowRunStatus,
} from "@/lib/utils/api";
import { swrKeys } from "./keys";

const TERMINAL_STATUSES: WorkflowRunStatus[] = ["success", "failure"];

export function useWorkflowRun(
  id: string | null,
  options?: { fallbackData?: WorkflowRunDetail },
) {
  return useSWR<WorkflowRunDetail>(
    id ? swrKeys.workflowRun(id) : null,
    () => fetchWorkflowRun(id!),
    {
      fallbackData: options?.fallbackData,
      refreshInterval: (data) =>
        data && TERMINAL_STATUSES.includes(data.status) ? 0 : 2000,
    },
  );
}
