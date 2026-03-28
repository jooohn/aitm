import { NextRequest, NextResponse } from "next/server";
import { failSession } from "@/lib/sessions";

type Params = Promise<{ id: string }>;

function errorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : "Internal server error";
  if (message.includes("not found"))
    return NextResponse.json({ error: message }, { status: 404 });
  if (message.includes("terminal state"))
    return NextResponse.json({ error: message }, { status: 422 });
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const session = failSession(id);
    return NextResponse.json(session);
  } catch (err) {
    return errorResponse(err);
  }
}
