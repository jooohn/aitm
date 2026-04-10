import { NextRequest, NextResponse } from "next/server";
import { processService, repositoryService } from "@/backend/container";

type Params = Promise<{
  organization: string;
  name: string;
  branch: string;
  processId: string;
}>;

const POLL_INTERVAL_MS = 500;

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<Response | NextResponse> {
  const { organization, name, processId } = await params;
  const repo = await repositoryService.getRepositoryByAlias(
    `${organization}/${name}`,
  );
  if (!repo) {
    return NextResponse.json(
      { error: "Repository not found" },
      { status: 404 },
    );
  }

  const process = processService.getProcess(processId);
  if (!process) {
    return NextResponse.json({ error: "Process not found" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let lastOffset = 0;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      function sendNewOutput() {
        try {
          const output = processService.getOutput(processId);
          if (output.length > lastOffset) {
            const newLines = output.slice(lastOffset);
            lastOffset = output.length;
            for (const line of newLines) {
              controller.enqueue(encoder.encode(`data: ${line}\n\n`));
            }
          }
        } catch {
          // process may have been cleaned up
        }
      }

      function checkAndClose() {
        const current = processService.getProcess(processId);
        if (!current || current.status !== "running") {
          sendNewOutput();
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

      // Send existing output immediately
      sendNewOutput();

      // If already terminal, close immediately
      const current = processService.getProcess(processId);
      if (!current || current.status !== "running") {
        try {
          controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
          controller.close();
        } catch {
          // stream already closed
        }
        return;
      }

      // Poll for new output
      intervalId = setInterval(() => {
        sendNewOutput();
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
