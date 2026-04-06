import { eventBus } from "@/backend/infra/event-bus";

export async function GET(_request: Request): Promise<Response> {
  const encoder = new TextEncoder();

  let sessionListener:
    | ((payload: { sessionId: string; status: string }) => void)
    | null = null;
  let approvalListener:
    | ((payload: { stepExecutionId: string; workflowRunId: string }) => void)
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

      sessionListener = enqueue;
      approvalListener = enqueue;

      eventBus.on("session.status-changed", sessionListener);
      eventBus.on("step-execution.awaiting-approval", approvalListener);
    },
    cancel() {
      if (sessionListener) {
        eventBus.off("session.status-changed", sessionListener);
      }
      if (approvalListener) {
        eventBus.off("step-execution.awaiting-approval", approvalListener);
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
