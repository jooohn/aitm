import useSWR from "swr";
import { type ChatDetail, type ChatStatus, fetchChat } from "@/lib/utils/api";
import { swrKeys } from "./keys";

const STABLE_STATUSES: ChatStatus[] = ["idle", "failed"];

export function useChat(id: string | null) {
  return useSWR<ChatDetail>(
    id ? swrKeys.chat(id) : null,
    () => fetchChat(id!),
    {
      refreshInterval: (data) =>
        data && STABLE_STATUSES.includes(data.status) ? 0 : 2000,
    },
  );
}
