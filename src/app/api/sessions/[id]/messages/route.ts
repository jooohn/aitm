import { NextRequest, NextResponse } from "next/server";
import {
  deliverAnswer,
  hasPendingQuestion,
} from "@/lib/domain/pending-questions";
import {
  getSession,
  listMessages,
  saveMessage,
  sendUserMessage,
} from "@/lib/domain/sessions";

type Params = Promise<{ id: string }>;

function errorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : "Internal server error";
  if (message.includes("not found"))
    return NextResponse.json({ error: message }, { status: 404 });
  if (message.includes("not waiting for input"))
    return NextResponse.json({ error: message }, { status: 422 });
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const session = getSession(id);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json(listMessages(id));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = await request.json();
    if (!body.content?.trim()) {
      return NextResponse.json(
        { error: "content is required" },
        { status: 422 },
      );
    }
    // MCP path: deliver answer to the waiting question handler.
    if (hasPendingQuestion(id)) {
      saveMessage(id, "user", body.content);
      deliverAnswer(id, body.content);
      return new NextResponse(null, { status: 204 });
    }

    // In-process SDK path (tests / non-CLI sessions).
    sendUserMessage(id, body.content);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
