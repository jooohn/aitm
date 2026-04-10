import { NextRequest, NextResponse } from "next/server";
import { toWorkflowRunDto } from "@/backend/api/dto";
import { errorResponse } from "@/backend/api/error-response";
import { workflowRunService } from "@/backend/container";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const newRun = await workflowRunService.rerunWorkflowRun(id);
    return NextResponse.json(toWorkflowRunDto(newRun), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
