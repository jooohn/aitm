"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchPendingApprovals, fetchSessionsByStatus } from "@/lib/utils/api";
import { useNotificationStream } from "./useNotificationStream";

export function useAwaitingInputCount(): { count: number } {
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    Promise.all([
      fetchSessionsByStatus("AWAITING_INPUT"),
      fetchPendingApprovals(),
    ])
      .then(([sessions, approvals]) => {
        setCount(sessions.length + approvals.length);
      })
      .catch(() => {
        // Silently keep the previous count on error
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useNotificationStream(refresh);

  return { count };
}
