import { NextRequest, NextResponse } from "next/server";
import { toChatDetailDto } from "@/backend/api/dto";
import { errorResponse } from "@/backend/api/error-response";
import { getContainer } from "@/backend/container";

type Params = Promise<{ id: string }>;

export async function POST(
  request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  try {
    const { chatService } = getContainer();
    const { id } = await params;
    const body = await request.json();
    const { message } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "message is required" },
        { status: 422 },
      );
    }

    await chatService.sendMessage(id, message);

    // Return updated chat (status will be "running")
    const chat = chatService.getChat(id);
    if (!chat) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }
    const proposals = chatService.listProposals(id);
    return NextResponse.json(toChatDetailDto(chat, proposals));
  } catch (err) {
    return errorResponse(err);
  }
}
