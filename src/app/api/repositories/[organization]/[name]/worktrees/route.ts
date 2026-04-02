import { NextRequest, NextResponse } from "next/server";
import { repositoryService, worktreeService } from "@/backend/container";

type Params = Promise<{ organization: string; name: string }>;

function errorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : "Internal server error";
  if (message.includes("not found"))
    return NextResponse.json({ error: message }, { status: 404 });
  if (message.includes("is the main worktree"))
    return NextResponse.json({ error: message }, { status: 422 });
  if (message.includes("git-worktree-runner is not installed"))
    return NextResponse.json({ error: message }, { status: 503 });
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  try {
    const { organization, name } = await params;
    const repo = await repositoryService.getRepositoryByAlias(
      `${organization}/${name}`,
    );
    if (!repo) {
      return NextResponse.json(
        { error: "Repository not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(await worktreeService.listWorktrees(repo.path));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  try {
    const { organization, name } = await params;
    const repo = await repositoryService.getRepositoryByAlias(
      `${organization}/${name}`,
    );
    if (!repo) {
      return NextResponse.json(
        { error: "Repository not found" },
        { status: 404 },
      );
    }
    const body = await request.json();
    const worktree = await worktreeService.createWorktree(
      repo.path,
      body.branch,
      {
        name: body.name,
        no_fetch: body.no_fetch,
      },
    );
    return NextResponse.json(worktree, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
