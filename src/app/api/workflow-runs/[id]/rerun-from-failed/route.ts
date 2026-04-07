import { NextRequest, NextResponse } from "next/server";
import { toWorkflowRunDetailDto } from "@/backend/api/dto";
import { workflowRunService } from "@/backend/container";

function errorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : "Internal server error";
  if (message.includes("not found"))
    return NextResponse.json({ error: message }, { status: 404 });
  if (message === "Only failed workflow runs can be re-run from failed state")
    return NextResponse.json({ error: message }, { status: 422 });
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const run = await workflowRunService.rerunWorkflowRunFromFailedState(id);
    return NextResponse.json(toWorkflowRunDetailDto(run), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
