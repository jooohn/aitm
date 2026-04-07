import { NextRequest, NextResponse } from "next/server";
import { toWorkflowRunDetailDto } from "@/backend/api/dto";
import { workflowRunService } from "@/backend/container";

function errorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : "Internal server error";
  if (message.includes("not found")) {
    return NextResponse.json({ error: message }, { status: 404 });
  }
  if (
    message === "Workflow run is not running" ||
    message === "Active step execution is not a manual-approval step"
  ) {
    return NextResponse.json({ error: message }, { status: 422 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = await request.json();
    const { decision, reason } = body;

    if (decision !== "approved" && decision !== "rejected") {
      return NextResponse.json(
        { error: "Invalid decision. Must be 'approved' or 'rejected'." },
        { status: 400 },
      );
    }

    const run = await workflowRunService.resolveManualApproval(
      id,
      decision,
      typeof reason === "string" ? reason : undefined,
    );
    return NextResponse.json(toWorkflowRunDetailDto(run), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
