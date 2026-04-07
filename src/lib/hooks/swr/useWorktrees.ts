import useSWR from "swr";
import { fetchWorktrees, type Worktree } from "@/lib/utils/api";
import { swrKeys } from "./keys";

export function useWorktrees(org: string, name: string) {
  return useSWR<Worktree[]>(swrKeys.worktrees(org, name), () =>
    fetchWorktrees(org, name),
  );
}
