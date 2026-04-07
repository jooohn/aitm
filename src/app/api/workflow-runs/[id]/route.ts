import { NextRequest, NextResponse } from "next/server";
import { toWorkflowRunDetailDto } from "@/backend/api/dto";
import { workflowRunService } from "@/backend/container";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const run = workflowRunService.getWorkflowRun(id);
  if (!run) {
    return NextResponse.json(
      { error: "Workflow run not found" },
      { status: 404 },
    );
  }
  return NextResponse.json(toWorkflowRunDetailDto(run));
}
