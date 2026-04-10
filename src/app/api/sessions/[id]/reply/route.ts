import { NextRequest, NextResponse } from "next/server";
import { toSessionDto } from "@/backend/api/dto";
import { errorResponse } from "@/backend/api/error-response";
import { getContainer } from "@/backend/container";

type Params = Promise<{ id: string }>;

export async function POST(
  request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  const { sessionService } = getContainer();
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
    return NextResponse.json(session ? toSessionDto(session) : null);
  } catch (err) {
    return errorResponse(err);
  }
}
