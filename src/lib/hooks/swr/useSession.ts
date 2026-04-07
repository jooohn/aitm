import useSWR from "swr";
import {
  fetchSession,
  type Session,
  type SessionStatus,
} from "@/lib/utils/api";
import { swrKeys } from "./keys";

const TERMINAL_STATUSES: SessionStatus[] = ["success", "failure"];

export function useSession(
  id: string | null,
  options?: { fallbackData?: Session },
) {
  return useSWR<Session>(
    id ? swrKeys.session(id) : null,
    () => fetchSession(id!),
    {
      fallbackData: options?.fallbackData,
      refreshInterval: (data) =>
        data && TERMINAL_STATUSES.includes(data.status) ? 0 : 2000,
    },
  );
}
