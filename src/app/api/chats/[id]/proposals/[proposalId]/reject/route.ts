import { NextRequest, NextResponse } from "next/server";
import { chatService } from "@/backend/container";

type Params = Promise<{ id: string; proposalId: string }>;

function errorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : "Internal server error";
  if (message.includes("not found"))
    return NextResponse.json({ error: message }, { status: 404 });
  if (message.includes("already"))
    return NextResponse.json({ error: message }, { status: 409 });
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  try {
    const { id, proposalId } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = body.reason as string | undefined;

    await chatService.rejectProposal(id, proposalId, reason);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
