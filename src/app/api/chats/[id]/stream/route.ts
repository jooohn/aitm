import { access, readFile } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/backend/container";

type Params = Promise<{ id: string }>;

const DONE_STATUSES = new Set(["idle", "awaiting_input", "failed"]);
const POLL_INTERVAL_MS = 500;

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<Response | NextResponse> {
  const { chatService } = getContainer();
  const { id } = await params;
  const chat = chatService.getChat(id);
  if (!chat) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  const logFilePath = chat.log_file_path;
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
        const current = chatService.getChat(id);
        if (!current || DONE_STATUSES.has(current.status)) {
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
        const currentChat = chatService.getChat(id);
        if (DONE_STATUSES.has(currentChat?.status ?? "failed")) {
          try {
            controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
            controller.close();
          } catch {
            // already closed
          }
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
