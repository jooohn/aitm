import { NextRequest, NextResponse } from "next/server";
import { validateRepository } from "@/lib/repositories";

function errorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : "Internal server error";
  if (message.includes("not found")) return NextResponse.json({ error: message }, { status: 404 });
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const result = validateRepository(Number(id));
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
