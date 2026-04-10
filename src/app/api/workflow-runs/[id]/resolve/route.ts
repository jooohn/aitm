import { NextRequest, NextResponse } from "next/server";
import { toWorkflowRunDetailDto } from "@/backend/api/dto";
import { errorResponse } from "@/backend/api/error-response";
import { workflowRunService } from "@/backend/container";

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
