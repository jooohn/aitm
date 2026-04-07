"use client";

import { useSWRConfig } from "swr";
import { useNotificationStream } from "../useNotificationStream";

export function useNotificationRevalidation(): void {
  const { mutate } = useSWRConfig();
  useNotificationStream(() => {
    void mutate(() => true, undefined, { revalidate: true });
  });
}
