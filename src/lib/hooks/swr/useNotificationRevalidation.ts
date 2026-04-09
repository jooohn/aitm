"use client";

import { useEffect, useRef } from "react";
import { useSWRConfig } from "swr";
import type { NotificationEvent } from "@/shared/contracts/api";
import { useNotificationStream } from "../useNotificationStream";
import { swrKeys } from "./keys";

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
    const notification = parseNotificationEvent(event);
    if (!notification) return;

    if (notification.type === "house-keeping.sync-status-changed") {
      if (notification.payload.syncing === false) {
        void mutate(isWorktreeListKey, undefined, { revalidate: true });
      }
      return;
    }

    if (notification.type === "worktree.changed") {
      void mutate(isWorktreeListKey, undefined, { revalidate: true });
      return;
    }

    if (
      notification.type === "workflow-run.status-changed" ||
      notification.type === "step-execution.status-changed"
    ) {
      pendingWorkflowRunIdsRef.current.add(notification.payload.workflowRunId);

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
    }
  });
}
