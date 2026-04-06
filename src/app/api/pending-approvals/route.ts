import { NextResponse } from "next/server";
import { workflowRunService } from "@/backend/container";

export function GET(): NextResponse {
  try {
    const approvals = workflowRunService.listPendingApprovals();
    return NextResponse.json(approvals);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
