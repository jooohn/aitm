import { NextRequest, NextResponse } from "next/server";
import { listRepositories, registerRepository } from "@/lib/repositories";

function errorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : "Internal server error";
  if (message.includes("not found"))
    return NextResponse.json({ error: message }, { status: 404 });
  if (message.includes("already registered"))
    return NextResponse.json({ error: message }, { status: 409 });
  if (
    message.includes("does not exist") ||
    message.includes("not a git repository")
  ) {
    return NextResponse.json({ error: message }, { status: 422 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(listRepositories());
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const repo = registerRepository(body);
    return NextResponse.json(repo, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
