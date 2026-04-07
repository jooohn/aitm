import useSWR from "swr";
import { fetchRepository, type RepositoryDetail } from "@/lib/utils/api";
import { swrKeys } from "./keys";

export function useRepository(org: string, name: string) {
  return useSWR<RepositoryDetail>(swrKeys.repository(org, name), () =>
    fetchRepository(org, name),
  );
}
