import useSWR from "swr";
import { fetchProcesses, type Process } from "@/lib/utils/api";
import { swrKeys } from "./keys";

export function useProcesses(
  org: string | null,
  name: string | null,
  branch: string | null,
) {
  return useSWR<Process[]>(
    org && name && branch ? swrKeys.processes(org, name, branch) : null,
    () => fetchProcesses(org!, name!, branch!),
  );
}
