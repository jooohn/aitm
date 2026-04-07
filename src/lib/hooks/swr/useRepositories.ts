import useSWR from "swr";
import { fetchRepositories, type Repository } from "@/lib/utils/api";
import { swrKeys } from "./keys";

export function useRepositories() {
  return useSWR<Repository[]>(swrKeys.repositories(), fetchRepositories);
}
