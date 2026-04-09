"use client";

import { useState } from "react";
import type { NotificationEvent } from "@/shared/contracts/api";
import { useNotificationStream } from "./useNotificationStream";

function parseNotificationEvent(event: MessageEvent): NotificationEvent | null {
  try {
    const data = JSON.parse(event.data);
    if (typeof data?.type === "string" && "payload" in data) {
      return data as NotificationEvent;
    }
    return null;
  } catch {
    return null;
  }
}

export function useHouseKeepingSyncing(): boolean {
  const [syncing, setSyncing] = useState(false);

  useNotificationStream((event) => {
    const notification = parseNotificationEvent(event);
    if (notification?.type !== "house-keeping.sync-status-changed") return;
    setSyncing(notification.payload.syncing);
  });

  return syncing;
}
