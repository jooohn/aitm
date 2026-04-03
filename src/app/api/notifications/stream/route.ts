import { eventBus } from "@/backend/infra/event-bus";

export async function GET(_request: Request): Promise<Response> {
  const encoder = new TextEncoder();

  let listener:
    | ((payload: { sessionId: string; status: string }) => void)
    | null = null;

  const stream = new ReadableStream({
    start(controller) {
      listener = (payload) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
        } catch {
          // stream already closed
        }
      };

      eventBus.on("session.status-changed", listener);
    },
    cancel() {
      if (listener) {
        eventBus.off("session.status-changed", listener);
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
