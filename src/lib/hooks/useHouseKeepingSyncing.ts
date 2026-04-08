"use client";

import { useState } from "react";
import { useNotificationStream } from "./useNotificationStream";

type NotificationPayload = {
  syncing?: unknown;
};

function parseNotificationPayload(
  event: MessageEvent,
): NotificationPayload | null {
  try {
    return JSON.parse(event.data) as NotificationPayload;
  } catch {
    return null;
  }
}

export function useHouseKeepingSyncing(): boolean {
  const [syncing, setSyncing] = useState(false);

  useNotificationStream((event) => {
    const payload = parseNotificationPayload(event);
    if (typeof payload?.syncing !== "boolean") return;
    setSyncing(payload.syncing);
  });

  return syncing;
}
