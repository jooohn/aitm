"use client";

import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { AlertProvider } from "@/lib/alert/AlertContext";
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
        refreshInterval: 15000,
      }}
    >
      <AlertProvider>
        <NotificationRevalidator />
        {children}
      </AlertProvider>
    </SWRConfig>
  );
}
