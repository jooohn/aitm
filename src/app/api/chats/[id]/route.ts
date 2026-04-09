import { NextRequest, NextResponse } from "next/server";
import { toChatDetailDto } from "@/backend/api/dto";
import { chatService } from "@/backend/container";

type Params = Promise<{ id: string }>;

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  const { id } = await params;
  const chat = chatService.getChat(id);
  if (!chat) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }
  const proposals = chatService.listProposals(id);
  return NextResponse.json(toChatDetailDto(chat, proposals));
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  const { id } = await params;
  const deleted = await chatService.closeChat(id);
  if (!deleted) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
