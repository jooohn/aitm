import { NextRequest, NextResponse } from "next/server";
import { toSessionDto } from "@/backend/api/dto";
import { domainResultToApiResult } from "@/backend/api/error-response";
import { getContainer } from "@/backend/container";

type Params = Promise<{ id: string }>;

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  const { sessionService } = getContainer();
  const { id } = await params;
  const result = domainResultToApiResult(sessionService.getSession(id));
  if (!result.ok) return result.response;
  return NextResponse.json(toSessionDto(result.data));
}
