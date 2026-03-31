import { NextRequest, NextResponse } from "next/server";
import { submitWorkflowRunInput } from "@/lib/domain/workflow-runs";

function errorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : "Internal server error";
  if (message.includes("not found"))
    return NextResponse.json({ error: message }, { status: 404 });
  if (message.includes("not waiting for input"))
    return NextResponse.json({ error: message }, { status: 422 });
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = (await request.json()) as { user_input?: string };
    if (!body.user_input) {
      return NextResponse.json(
        { error: "user_input is required" },
        { status: 400 },
      );
    }
    const run = submitWorkflowRunInput(id, body.user_input);
    return NextResponse.json(run, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
