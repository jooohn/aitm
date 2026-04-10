import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/backend/api/error-response";
import { chatService } from "@/backend/container";

type Params = Promise<{ id: string; proposalId: string }>;

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
