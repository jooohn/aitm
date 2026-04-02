import { NextRequest, NextResponse } from "next/server";
import { workflowRunService } from "@/backend/container";

function errorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : "Internal server error";
  if (message.includes("not found")) {
    return NextResponse.json({ error: message }, { status: 404 });
  }
  if (
    message === "Workflow run is already in a terminal state" ||
    message === "No active session to stop for this workflow run"
  ) {
    return NextResponse.json({ error: message }, { status: 422 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const run = await workflowRunService.stopWorkflowRun(id);
    return NextResponse.json(run, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
