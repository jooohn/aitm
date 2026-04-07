import useSWR from "swr";
import {
  fetchAllWorkflowRuns,
  fetchWorkflowRuns,
  type WorkflowRun,
  type WorkflowRunStatus,
} from "@/lib/utils/api";
import { swrKeys } from "./keys";

export function useWorkflowRuns(
  repositoryPath: string | null,
  worktreeBranch?: string,
) {
  return useSWR<WorkflowRun[]>(
    repositoryPath
      ? swrKeys.workflowRuns({
          repository_path: repositoryPath,
          worktree_branch: worktreeBranch,
        })
      : null,
    () => fetchWorkflowRuns(repositoryPath!, worktreeBranch),
  );
}

export function useAllWorkflowRuns(status?: WorkflowRunStatus) {
  return useSWR<WorkflowRun[]>(
    swrKeys.workflowRuns(status ? { status } : undefined),
    () => fetchAllWorkflowRuns(status),
  );
}
