import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/backend/api/error-response";
import { getContainer } from "@/backend/container";

type Params = Promise<{ id: string; proposalId: string }>;

export async function POST(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  try {
    const { chatService } = getContainer();
    const { id, proposalId } = await params;
    const result = await chatService.diveDeep(id, proposalId);
    return NextResponse.json({ chat_id: result.chatId });
  } catch (err) {
    return errorResponse(err);
  }
}
