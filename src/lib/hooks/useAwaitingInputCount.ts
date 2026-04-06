"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchAllWorkflowRuns } from "@/lib/utils/api";
import { useNotificationStream } from "./useNotificationStream";

export function useAwaitingInputCount(): { count: number } {
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    fetchAllWorkflowRuns("awaiting")
      .then((runs) => {
        setCount(runs.length);
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
