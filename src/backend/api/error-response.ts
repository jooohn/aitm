import { NextResponse } from "next/server";
import { isDomainError } from "@/backend/domain/errors";

export function errorResponse(err: unknown): NextResponse {
  if (isDomainError(err)) {
    return NextResponse.json(
      { error: err.message },
      { status: err.statusCode },
    );
  }
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
