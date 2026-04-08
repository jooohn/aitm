"use client";

import { useSWRConfig } from "swr";
import { useNotificationStream } from "../useNotificationStream";
import { swrKeys } from "./keys";

type NotificationPayload = {
  workflowRunId?: unknown;
  stepExecutionId?: unknown;
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

function parseNotificationPayload(
  event: MessageEvent,
): NotificationPayload | null {
  try {
    return JSON.parse(event.data) as NotificationPayload;
  } catch {
    return null;
  }
}

export function useNotificationRevalidation(): void {
  const { mutate } = useSWRConfig();
  useNotificationStream((event) => {
    const payload = parseNotificationPayload(event);
    if (typeof payload?.workflowRunId !== "string") return;

    void mutate(swrKeys.workflowRun(payload.workflowRunId));
    void mutate(
      (key) => isWorkflowRunKey(key) || isWorkflowRunListKey(key),
      undefined,
      { revalidate: true },
    );
  });
}
