import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/backend/container";
import { spawnAsync } from "@/backend/utils/process";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { workflowRunService, worktreeService } = getContainer();
  const { id } = await params;

  const run = await workflowRunService.getWorkflowRunForDisplay(id);
  if (!run) {
    return NextResponse.json(
      { error: "Workflow run not found" },
      { status: 404 },
    );
  }

  const worktree = await worktreeService.findWorktree(
    run.repository_path,
    run.worktree_branch,
  );
  if (!worktree) {
    return NextResponse.json({ error: "Worktree not found" }, { status: 404 });
  }

  const [diffResult, statResult] = await Promise.all([
    spawnAsync("git", ["diff", "origin/main", "--", "."], {
      cwd: worktree.path,
    }),
    spawnAsync("git", ["diff", "--stat", "origin/main", "--", "."], {
      cwd: worktree.path,
    }),
  ]);

  if (diffResult.code !== 0) {
    return NextResponse.json(
      { error: `git diff failed: ${diffResult.stderr}` },
      { status: 500 },
    );
  }

  if (statResult.code !== 0) {
    return NextResponse.json(
      { error: `git diff --stat failed: ${statResult.stderr}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    diff: diffResult.stdout,
    stat: statResult.stdout,
  });
}
