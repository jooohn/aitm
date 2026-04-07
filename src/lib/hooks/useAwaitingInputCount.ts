"use client";

import { useAllWorkflowRuns } from "./swr";

export function useAwaitingInputCount(): { count: number } {
  const { data } = useAllWorkflowRuns("awaiting");
  return { count: data?.length ?? 0 };
}
