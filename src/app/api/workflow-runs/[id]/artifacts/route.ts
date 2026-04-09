import { stat } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import {
  config,
  workflowRunService,
  worktreeService,
} from "@/backend/container";
import { resolveArtifactBasePath } from "@/backend/domain/worktrees";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const run = workflowRunService.getWorkflowRun(id);
  if (!run) {
    return NextResponse.json(
      { error: "Workflow run not found" },
      { status: 404 },
    );
  }

  const workflow = config.workflows[run.workflow_name];
  const artifacts = workflow?.artifacts ?? [];

  const worktree = await worktreeService.findWorktree(
    run.repository_path,
    run.worktree_branch,
  );
  if (!worktree) {
    return NextResponse.json({ error: "Worktree not found" }, { status: 404 });
  }
  const artifactRoot = resolveArtifactBasePath(worktree, run.id);

  const results = await Promise.all(
    artifacts.map(async (artifact) => {
      const filePath = join(artifactRoot, artifact.path);
      const exists = await stat(filePath)
        .then((s) => s.isFile() && s.size > 0)
        .catch(() => false);
      return {
        name: artifact.name,
        path: artifact.path,
        ...(artifact.description ? { description: artifact.description } : {}),
        exists,
      };
    }),
  );

  return NextResponse.json(results);
}
