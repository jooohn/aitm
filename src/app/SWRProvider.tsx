"use client";

import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { useNotificationRevalidation } from "@/lib/hooks/swr/useNotificationRevalidation";

function NotificationRevalidator() {
  useNotificationRevalidation();
  return null;
}

export default function SWRProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        dedupingInterval: 1000,
        keepPreviousData: true,
      }}
    >
      <NotificationRevalidator />
      {children}
    </SWRConfig>
  );
}
