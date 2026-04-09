import type { EventMap } from "@/backend/infra/event-bus";
import { eventBus } from "@/backend/infra/event-bus";
import type { NotificationEvent } from "@/shared/contracts/api";

export async function GET(_request: Request): Promise<Response> {
  const encoder = new TextEncoder();

  let houseKeepingSyncStatusChangedListener:
    | ((payload: EventMap["house-keeping.sync-status-changed"]) => void)
    | null = null;

  let statusChangedListener:
    | ((payload: EventMap["workflow-run.status-changed"]) => void)
    | null = null;

  let stepExecutionStatusChangedListener:
    | ((payload: EventMap["step-execution.status-changed"]) => void)
    | null = null;

  let worktreeChangedListener:
    | ((payload: EventMap["worktree.changed"]) => void)
    | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const enqueue = (event: NotificationEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          // stream already closed
        }
      };

      const latestHouseKeepingSyncStatus =
        eventBus.getLatestHouseKeepingSyncStatus();
      if (latestHouseKeepingSyncStatus) {
        enqueue({
          type: "house-keeping.sync-status-changed",
          payload: latestHouseKeepingSyncStatus,
        });
      }

      houseKeepingSyncStatusChangedListener = (payload) =>
        enqueue({ type: "house-keeping.sync-status-changed", payload });
      statusChangedListener = (payload) =>
        enqueue({ type: "workflow-run.status-changed", payload });
      stepExecutionStatusChangedListener = (payload) =>
        enqueue({ type: "step-execution.status-changed", payload });
      worktreeChangedListener = () =>
        enqueue({ type: "worktree.changed", payload: {} });

      eventBus.on(
        "house-keeping.sync-status-changed",
        houseKeepingSyncStatusChangedListener,
      );
      eventBus.on("workflow-run.status-changed", statusChangedListener);
      eventBus.on(
        "step-execution.status-changed",
        stepExecutionStatusChangedListener,
      );
      eventBus.on("worktree.changed", worktreeChangedListener);
    },
    cancel() {
      if (houseKeepingSyncStatusChangedListener) {
        eventBus.off(
          "house-keeping.sync-status-changed",
          houseKeepingSyncStatusChangedListener,
        );
      }
      if (statusChangedListener) {
        eventBus.off("workflow-run.status-changed", statusChangedListener);
      }
      if (stepExecutionStatusChangedListener) {
        eventBus.off(
          "step-execution.status-changed",
          stepExecutionStatusChangedListener,
        );
      }
      if (worktreeChangedListener) {
        eventBus.off("worktree.changed", worktreeChangedListener);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
