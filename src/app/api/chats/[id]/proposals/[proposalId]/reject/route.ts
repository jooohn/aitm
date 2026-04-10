import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/backend/api/error-response";
import { getContainer } from "@/backend/container";

type Params = Promise<{ id: string; proposalId: string }>;

export async function POST(
  request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  try {
    const { chatService } = getContainer();
    const { id, proposalId } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = body.reason as string | undefined;

    await chatService.rejectProposal(id, proposalId, reason);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
