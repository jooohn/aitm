import { NextRequest, NextResponse } from "next/server";
import { sessionService } from "@/backend/container";

type Params = Promise<{ id: string }>;

export async function POST(
  request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  const { id } = await params;

  let body: { message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.message || typeof body.message !== "string") {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  try {
    await sessionService.replyToSession(id, body.message);
    const session = sessionService.getSession(id);
    return NextResponse.json(session);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    if (message.includes("not found"))
      return NextResponse.json({ error: message }, { status: 404 });
    if (message.includes("not awaiting input"))
      return NextResponse.json({ error: message }, { status: 422 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
