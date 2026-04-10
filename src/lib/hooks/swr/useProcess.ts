import useSWR from "swr";
import { fetchProcess, type Process } from "@/lib/utils/api";
import { swrKeys } from "./keys";

export function useProcess(
  org: string | null,
  name: string | null,
  branch: string | null,
  processId: string | null,
) {
  return useSWR<Process>(
    org && name && branch && processId
      ? swrKeys.process(org, name, branch, processId)
      : null,
    () => fetchProcess(org!, name!, branch!, processId!),
  );
}
