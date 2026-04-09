import { NextRequest, NextResponse } from "next/server";
import { toChatDetailDto } from "@/backend/api/dto";
import { chatService } from "@/backend/container";

type Params = Promise<{ id: string }>;

function errorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : "Internal server error";
  if (message.includes("not found"))
    return NextResponse.json({ error: message }, { status: 404 });
  if (message.includes("already running"))
    return NextResponse.json({ error: message }, { status: 409 });
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  try {
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
