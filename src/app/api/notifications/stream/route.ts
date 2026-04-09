import { eventBus } from "@/backend/infra/event-bus";

export async function GET(_request: Request): Promise<Response> {
  const encoder = new TextEncoder();

  let houseKeepingSyncStatusChangedListener:
    | ((payload: { syncing: boolean }) => void)
    | null = null;

  let statusChangedListener:
    | ((payload: { workflowRunId: string; status: string }) => void)
    | null = null;

  let stepExecutionStatusChangedListener:
    | ((payload: {
        stepExecutionId: string;
        workflowRunId: string;
        status: string;
      }) => void)
    | null = null;

  let worktreeChangedListener:
    | ((payload: Record<string, never>) => void)
    | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const enqueue = (payload: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
        } catch {
          // stream already closed
        }
      };

      const latestHouseKeepingSyncStatus =
        eventBus.getLatestHouseKeepingSyncStatus();
      if (latestHouseKeepingSyncStatus) {
        enqueue(latestHouseKeepingSyncStatus);
      }

      houseKeepingSyncStatusChangedListener = enqueue;
      statusChangedListener = enqueue;
      stepExecutionStatusChangedListener = enqueue;
      worktreeChangedListener = () => enqueue({ worktreeChanged: true });

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
