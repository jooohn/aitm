import { NextRequest, NextResponse } from "next/server";
import { toSessionDto } from "@/backend/api/dto";
import { domainResultToApiResult } from "@/backend/api/error-response";
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

  const replyResult = domainResultToApiResult(
    await sessionService.replyToSession(id, body.message),
  );
  if (!replyResult.ok) return replyResult.response;

  const sessionResult = domainResultToApiResult(sessionService.getSession(id));
  if (!sessionResult.ok) return sessionResult.response;

  return NextResponse.json(toSessionDto(sessionResult.data));
}
