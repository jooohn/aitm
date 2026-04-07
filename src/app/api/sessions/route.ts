import { NextRequest, NextResponse } from "next/server";
import { toSessionDto } from "@/backend/api/dto";
import { sessionService } from "@/backend/container";
import type { SessionStatus } from "@/backend/domain/sessions";

function errorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : "Internal server error";
  if (message.includes("not found"))
    return NextResponse.json({ error: message }, { status: 404 });
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = request.nextUrl;
    const repository_path = searchParams.get("repository_path") ?? undefined;
    const worktree_branch = searchParams.get("worktree_branch") ?? undefined;
    const statusParam = searchParams.get("status") ?? undefined;
    const status = statusParam as SessionStatus | undefined;

    return NextResponse.json(
      sessionService
        .listSessions({ repository_path, worktree_branch, status })
        .map(toSessionDto),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
