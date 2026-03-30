import { NextRequest, NextResponse } from "next/server";
import { getWorkflowRun } from "@/lib/domain/workflow-runs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const run = getWorkflowRun(id);
  if (!run) {
    return NextResponse.json(
      { error: "Workflow run not found" },
      { status: 404 },
    );
  }
  return NextResponse.json(run);
}
