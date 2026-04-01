import { NextRequest, NextResponse } from "next/server";
import { sessionService, worktreeService } from "@/lib/container";
import { getRepositoryByAlias } from "@/lib/domain/repositories";

type Params = Promise<{ organization: string; name: string }>;

function errorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : "Internal server error";
  if (message.includes("not found"))
    return NextResponse.json({ error: message }, { status: 404 });
  if (message.includes("git-worktree-runner is not installed"))
    return NextResponse.json({ error: message }, { status: 503 });
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  try {
    const { organization, name } = await params;
    const repo = getRepositoryByAlias(`${organization}/${name}`);
    if (!repo) {
      return NextResponse.json(
        { error: "Repository not found" },
        { status: 404 },
      );
    }
    const removedBranches = worktreeService.cleanMergedWorktrees(repo.path);
    sessionService.deleteWorktreeData(repo.path, removedBranches);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
