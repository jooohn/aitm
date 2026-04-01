import { existsSync, readFileSync } from "fs";
import { NextRequest, NextResponse } from "next/server";
import { sessionService } from "@/lib/container";

type Params = Promise<{ id: string }>;

const TERMINAL_STATUSES = new Set(["SUCCEEDED", "FAILED"]);
const POLL_INTERVAL_MS = 500;

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<Response | NextResponse> {
  const { id } = await params;
  const session = sessionService.getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const logFilePath = session.log_file_path;
  const encoder = new TextEncoder();
  let offset = 0;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      function sendNewLines() {
        try {
          if (!existsSync(logFilePath)) return;
          const content = readFileSync(logFilePath, "utf8");
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

      function checkAndClose() {
        const current = sessionService.getSession(id);
        if (!current || TERMINAL_STATUSES.has(current.status)) {
          sendNewLines();
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

      sendNewLines();

      if (
        TERMINAL_STATUSES.has(sessionService.getSession(id)?.status ?? "FAILED")
      ) {
        controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
        controller.close();
        return;
      }

      intervalId = setInterval(() => {
        sendNewLines();
        checkAndClose();
      }, POLL_INTERVAL_MS);
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
