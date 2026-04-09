import useSWR from "swr";
import {
  type ArtifactStatus,
  fetchArtifactStatuses,
  type WorkflowRunStatus,
} from "@/lib/utils/api";
import { swrKeys } from "./keys";

const TERMINAL_STATUSES: WorkflowRunStatus[] = ["success", "failure"];

export function useArtifactStatuses(
  runId: string,
  runStatus: WorkflowRunStatus,
) {
  return useSWR<ArtifactStatus[]>(
    swrKeys.artifactStatuses(runId),
    () => fetchArtifactStatuses(runId),
    {
      refreshInterval: TERMINAL_STATUSES.includes(runStatus) ? 0 : 5000,
    },
  );
}
