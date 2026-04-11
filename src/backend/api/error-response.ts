import { NextResponse } from "next/server";
import type { DomainError } from "@/backend/domain/errors";
import { isDomainError } from "@/backend/domain/errors";
import type { DomainResult } from "@/backend/domain/result";
import type { ApiResult } from "./request";

export function errorResponse(err: unknown): NextResponse {
  if (isDomainError(err)) {
    return NextResponse.json(
      { error: err.message },
      { status: err.statusCode },
    );
  }
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export function domainResultToApiResult<T>(
  result: DomainResult<T, DomainError>,
): ApiResult<T> {
  if (result.ok) {
    return { ok: true, data: result.value };
  }
  return {
    ok: false,
    response: NextResponse.json(
      { error: result.error.message },
      { status: result.error.statusCode },
    ),
  };
}
