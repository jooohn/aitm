import useSWR from "swr";
import { type Chat, fetchChats } from "@/lib/utils/api";
import { swrKeys } from "./keys";

export function useChats(organization: string, name: string) {
  return useSWR<Chat[]>(swrKeys.chats(organization, name), () =>
    fetchChats(organization, name),
  );
}
