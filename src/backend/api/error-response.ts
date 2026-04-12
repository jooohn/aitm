import { NextResponse } from "next/server";
import type { DomainError } from "@/backend/domain/errors";
import { isDomainError } from "@/backend/domain/errors";
import type { DomainResult } from "@/backend/domain/result";

export function errorResponse(err: unknown): NextResponse {
  if (isDomainError(err)) {
    return NextResponse.json(
      { error: err.message },
      { status: err.statusCode },
    );
  }
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export function domainResultToResponse<T>(
  result: DomainResult<T, DomainError>,
): NextResponse {
  return result.fold<NextResponse>({
    ok: (value) => NextResponse.json(value),
    err: (error) =>
      NextResponse.json({ error: error.message }, { status: error.statusCode }),
  });
}
