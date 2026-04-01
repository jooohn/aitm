import { NextRequest, NextResponse } from "next/server";
import {
  repositoryService,
  sessionService,
  worktreeService,
} from "@/lib/container";

type Params = Promise<{ organization: string; name: string; branch: string[] }>;

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

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  try {
    const { organization, name, branch } = await params;
    const repo = repositoryService.getRepositoryByAlias(
      `${organization}/${name}`,
    );
    if (!repo) {
      return NextResponse.json(
        { error: "Repository not found" },
        { status: 404 },
      );
    }
    const branchName = branch.join("/");
    worktreeService.removeWorktree(repo.path, branchName);
    sessionService.deleteWorktreeData(repo.path, [branchName]);
    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
