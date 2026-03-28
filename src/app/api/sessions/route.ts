import { NextRequest, NextResponse } from "next/server";
import { getRepositoryByAlias } from "@/lib/repositories";
import {
  createSession,
  listSessions,
  type SessionStatus,
} from "@/lib/sessions";

function errorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : "Internal server error";
  if (message.includes("not found"))
    return NextResponse.json({ error: message }, { status: 404 });
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = request.nextUrl;
    const repositoryIdParam = searchParams.get("repository_id");
    const worktreeBranch = searchParams.get("worktree_branch") ?? undefined;
    const statusParam = searchParams.get("status") ?? undefined;

    const repository_id = repositoryIdParam
      ? Number(repositoryIdParam)
      : undefined;
    const status = statusParam as SessionStatus | undefined;

    return NextResponse.json(
      listSessions({ repository_id, worktree_branch: worktreeBranch, status }),
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { organization, name, worktree_branch, goal, completion_condition } =
      body;

    if (
      !organization ||
      !name ||
      !worktree_branch ||
      !goal ||
      !completion_condition
    ) {
      return NextResponse.json(
        {
          error:
            "organization, name, worktree_branch, goal, and completion_condition are required",
        },
        { status: 422 },
      );
    }

    const repo = getRepositoryByAlias(`${organization}/${name}`);
    if (!repo) {
      return NextResponse.json(
        { error: "Repository not found" },
        { status: 404 },
      );
    }

    const session = createSession({
      repository_id: repo.id,
      worktree_branch,
      goal,
      completion_condition,
    });
    return NextResponse.json(session, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
