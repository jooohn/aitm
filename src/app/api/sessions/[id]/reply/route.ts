import { NextRequest, NextResponse } from "next/server";
import { toSessionDto } from "@/backend/api/dto";
import { domainResultToResponse } from "@/backend/api/error-response";
import { getContainer } from "@/backend/container";
import { flatMapResult, mapResult } from "@/backend/domain/result";

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

  const result = flatMapResult(
    await sessionService.replyToSession(id, body.message),
    () => mapResult(sessionService.getSession(id), toSessionDto),
  );
  return domainResultToResponse(result);
}
