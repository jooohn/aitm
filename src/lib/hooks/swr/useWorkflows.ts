import useSWR from "swr";
import { fetchWorkflows, type WorkflowDefinition } from "@/lib/utils/api";
import { swrKeys } from "./keys";

export function useWorkflows() {
  return useSWR<Record<string, WorkflowDefinition>>(
    swrKeys.workflows(),
    fetchWorkflows,
  );
}
