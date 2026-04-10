import { NextRequest, NextResponse } from "next/server";
import { toWorkflowRunDetailDto } from "@/backend/api/dto";
import { errorResponse } from "@/backend/api/error-response";
import { workflowRunService } from "@/backend/container";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const run = await workflowRunService.stopWorkflowRun(id);
    return NextResponse.json(toWorkflowRunDetailDto(run), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
