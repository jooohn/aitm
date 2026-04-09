"use client";

import { useEffect, useRef } from "react";
import { useSWRConfig } from "swr";
import { debounce } from "@/lib/utils/debounce";
import type { NotificationEvent } from "@/shared/contracts/api";
import { useNotificationStream } from "../useNotificationStream";

type TargetPaths = {
  exact?: string[];
  prefix?: string[];
};

const DEBOUNCE_MILLIS = 75;

function normalizeKey(key: unknown): string {
  const flattened = Array.isArray(key)
    ? key.filter((part) => typeof part === "string").join("/")
    : String(key);
  return flattened.endsWith("/") ? flattened : `${flattened}/`;
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

function matchesTargetPaths(target: TargetPaths) {
  return (key: unknown) => {
    const normalizedKey = normalizeKey(key);
    return (
      (target.exact ?? []).some((path) => normalizedKey === path) ||
      (target.prefix ?? []).some((prefix) => normalizedKey.startsWith(prefix))
    );
  };
}

function worktreePrefix(org: string, name: string): string {
  return `/api/repositories/${org}/${name}/worktrees/`;
}

function determineTargetPaths(notification: NotificationEvent): TargetPaths {
  switch (notification.type) {
    case "house-keeping.sync-status-changed":
      if (notification.payload.syncing) return {};
      return {
        prefix: ["/api/repositories/"],
      };
    case "worktree.changed": {
      const { repositoryOrganization, repositoryName } = notification.payload;
      return {
        prefix: [worktreePrefix(repositoryOrganization, repositoryName)],
      };
    }
    case "workflow-run.status-changed": {
      const { workflowRunId, repositoryOrganization, repositoryName } =
        notification.payload;
      return {
        exact: ["/api/workflow-runs/"],
        prefix: [
          `/api/workflow-runs/${workflowRunId}/`,
          worktreePrefix(repositoryOrganization, repositoryName),
        ],
      };
    }
    case "step-execution.status-changed": {
      const { workflowRunId, repositoryOrganization, repositoryName } =
        notification.payload;
      return {
        exact: ["/api/workflow-runs/", "/api/todos/"],
        prefix: [
          `/api/workflow-runs/${workflowRunId}/`,
          worktreePrefix(repositoryOrganization, repositoryName),
        ],
      };
    }
  }
}

function mergeTargetPaths(entries: TargetPaths[]): TargetPaths {
  const merged = entries.reduce((acc, targetPaths) => ({
    exact: [...(acc.exact ?? []), ...(targetPaths.exact ?? [])],
    prefix: [...(acc.prefix ?? []), ...(targetPaths.prefix ?? [])],
  }));
  return {
    exact: [...new Set(merged.exact ?? [])],
    prefix: [...new Set(merged.prefix ?? [])],
  };
}

export function useNotificationRevalidation(): void {
  const { mutate } = useSWRConfig();
  const bufferRef = useRef<NotificationEvent[]>([]);

  const debouncedFlush = useRef(
    debounce(() => {
      const notifications = bufferRef.current;
      if (notifications.length === 0) return;
      bufferRef.current = [];

      const targetPaths = mergeTargetPaths(
        notifications.map(determineTargetPaths),
      );
      void mutate(matchesTargetPaths(targetPaths), undefined, {
        revalidate: true,
      });
    }, DEBOUNCE_MILLIS),
  ).current;

  useEffect(() => {
    return () => debouncedFlush.cancel();
  }, [debouncedFlush]);

  useNotificationStream((event) => {
    const notification = parseNotificationEvent(event);
    if (!notification) return;
    bufferRef.current = [...bufferRef.current, notification];
    debouncedFlush();
  });
}
