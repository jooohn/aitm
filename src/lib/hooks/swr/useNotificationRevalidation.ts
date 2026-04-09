"use client";

import { useEffect, useRef } from "react";
import { useSWRConfig } from "swr";
import { useNotificationStream } from "../useNotificationStream";
import { swrKeys } from "./keys";

type NotificationPayload = {
  workflowRunId?: unknown;
  stepExecutionId?: unknown;
  syncing?: unknown;
};

function isWorkflowRunKey(
  key: unknown,
): key is readonly ["/api/workflow-runs"] {
  return (
    Array.isArray(key) && key.length === 1 && key[0] === "/api/workflow-runs"
  );
}

function isWorkflowRunListKey(
  key: unknown,
): key is readonly ["/api/workflow-runs", Record<string, string>] {
  return (
    Array.isArray(key) &&
    key.length === 2 &&
    key[0] === "/api/workflow-runs" &&
    typeof key[1] === "object" &&
    key[1] !== null
  );
}

function isWorktreeListKey(
  key: unknown,
): key is readonly ["/api/repositories", string, string, "worktrees"] {
  return (
    Array.isArray(key) &&
    key.length === 4 &&
    key[0] === "/api/repositories" &&
    typeof key[1] === "string" &&
    typeof key[2] === "string" &&
    key[3] === "worktrees"
  );
}

function parseNotificationPayload(
  event: MessageEvent,
): NotificationPayload | null {
  try {
    return JSON.parse(event.data) as NotificationPayload;
  } catch {
    return null;
  }
}

const REVALIDATION_DELAY_MS = 75;

export function useNotificationRevalidation(): void {
  const { mutate } = useSWRConfig();
  const pendingWorkflowRunIdsRef = useRef(new Set<string>());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingWorkflowRunIdsRef.current.clear();
    };
  }, []);

  useNotificationStream((event) => {
    const payload = parseNotificationPayload(event);

    if (payload?.syncing === false) {
      void mutate(isWorktreeListKey, undefined, { revalidate: true });
      return;
    }

    if (typeof payload?.workflowRunId !== "string") return;

    pendingWorkflowRunIdsRef.current.add(payload.workflowRunId);

    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
    }

    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      const workflowRunIds = [...pendingWorkflowRunIdsRef.current];
      pendingWorkflowRunIdsRef.current.clear();

      for (const workflowRunId of workflowRunIds) {
        void mutate(swrKeys.workflowRun(workflowRunId));
      }

      void mutate(
        (key) => isWorkflowRunKey(key) || isWorkflowRunListKey(key),
        undefined,
        { revalidate: true },
      );

      void mutate(isWorktreeListKey, undefined, { revalidate: true });
    }, REVALIDATION_DELAY_MS);
  });
}
