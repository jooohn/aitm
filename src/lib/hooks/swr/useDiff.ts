import useSWR from "swr";
import { type DiffResponse, fetchDiff } from "@/lib/utils/api";
import { swrKeys } from "./keys";

export function useDiff(org: string, name: string, branch: string | null) {
  return useSWR<DiffResponse>(
    branch ? swrKeys.diff(org, name, branch) : null,
    () => fetchDiff(org, name, branch!),
  );
}
