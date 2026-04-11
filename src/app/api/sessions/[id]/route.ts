import { NextRequest, NextResponse } from "next/server";
import { toSessionDto } from "@/backend/api/dto";
import { domainResultToResponse } from "@/backend/api/error-response";
import { getContainer } from "@/backend/container";
import { mapResult } from "@/backend/domain/result";

type Params = Promise<{ id: string }>;

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  const { sessionService } = getContainer();
  const { id } = await params;
  return domainResultToResponse(
    mapResult(sessionService.getSession(id), toSessionDto),
  );
}
