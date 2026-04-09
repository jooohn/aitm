import useSWR from "swr";
import {
  fetchAllWorkflowRuns,
  fetchWorkflowRuns,
  type WorkflowRun,
  type WorkflowRunStatus,
} from "@/lib/utils/api";
import { swrKeys } from "./keys";

export function useWorkflowRuns(
  organization: string | null,
  name: string | null,
  worktreeBranch?: string,
) {
  return useSWR<WorkflowRun[]>(
    organization && name
      ? swrKeys.workflowRuns({
          organization,
          name,
          worktree_branch: worktreeBranch,
        })
      : null,
    () => fetchWorkflowRuns(organization!, name!, worktreeBranch),
  );
}

export function useAllWorkflowRuns(status?: WorkflowRunStatus) {
  return useSWR<WorkflowRun[]>(
    swrKeys.workflowRuns(status ? { status } : undefined),
    () => fetchAllWorkflowRuns(status),
  );
}
