import { access, readFile } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/backend/container";

type Params = Promise<{ id: string }>;

const TERMINAL_STATUSES = new Set(["success", "failure"]);
const POLL_INTERVAL_MS = 500;

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<Response | NextResponse> {
  const { sessionService } = getContainer();
  const { id } = await params;
  const sessionResult = sessionService.getSession(id);
  const session = sessionResult.value;
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const logFilePath = session.log_file_path;
  const encoder = new TextEncoder();
  let offset = 0;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      async function sendNewLines() {
        try {
          await access(logFilePath);
          const content = await readFile(logFilePath, "utf8");
          if (content.length <= offset) return;
          const newContent = content.slice(offset);
          offset = content.length;
          for (const line of newContent.split("\n")) {
            if (line.trim()) {
              controller.enqueue(encoder.encode(`data: ${line}\n\n`));
            }
          }
        } catch {
          // ignore read errors
        }
      }

      async function checkAndClose() {
        const currentResult = sessionService.getSession(id);
        const current = currentResult.value;
        if (!current || TERMINAL_STATUSES.has(current.status)) {
          await sendNewLines();
          try {
            controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
            controller.close();
          } catch {
            // stream already closed
          }
          if (intervalId !== null) {
            clearInterval(intervalId);
            intervalId = null;
          }
        }
      }

      sendNewLines().then(() => {
        const initialResult = sessionService.getSession(id);
        const initialStatus = initialResult.value?.status ?? "failure";
        if (TERMINAL_STATUSES.has(initialStatus)) {
          controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
          controller.close();
          return;
        }

        intervalId = setInterval(() => {
          sendNewLines().then(() => checkAndClose());
        }, POLL_INTERVAL_MS);
      });
    },
    cancel() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
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
