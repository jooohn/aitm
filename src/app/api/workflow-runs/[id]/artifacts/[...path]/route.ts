import { readFile } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { extname, posix, resolve, sep } from "path";
import { getContainer } from "@/backend/container";
import { resolveArtifactBasePath } from "@/backend/domain/worktrees";

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

function isValidArtifactPath(pathSegments: string[]): boolean {
  return (
    pathSegments.length > 0 &&
    pathSegments.every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    )
  );
}

function resolveContentType(artifactPath: string): string {
  switch (extname(artifactPath).toLowerCase()) {
    case ".json":
      return "application/json; charset=utf-8";
    case ".md":
      return "text/markdown; charset=utf-8";
    case ".txt":
    case ".log":
    case ".yaml":
    case ".yml":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

export async function GET(
  _request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; path: string[] }>;
  },
): Promise<NextResponse> {
  const { config, workflowRunService, worktreeService } = getContainer();
  const { id, path } = await params;
  const run = workflowRunService.getWorkflowRun(id);
  if (!run) {
    return jsonError("Workflow run not found", 404);
  }

  if (!isValidArtifactPath(path)) {
    return jsonError("Invalid artifact path", 400);
  }

  const requestedPath = path.join("/");
  const workflow = config.workflows[run.workflow_name];
  const declaredArtifact = workflow?.artifacts?.find(
    (artifact) => artifact.path === requestedPath,
  );
  if (!declaredArtifact) {
    return jsonError("Artifact not found", 404);
  }

  const worktree = await worktreeService.findWorktree(
    run.repository_path,
    run.worktree_branch,
  );
  if (!worktree) {
    return jsonError("Worktree not found", 404);
  }
  const artifactRoot = resolveArtifactBasePath(worktree, run.id);
  const artifactPath = resolve(artifactRoot, requestedPath);
  const normalizedRoot = `${resolve(artifactRoot)}${sep}`;
  if (
    artifactPath !== resolve(artifactRoot) &&
    !artifactPath.startsWith(normalizedRoot)
  ) {
    return jsonError("Invalid artifact path", 400);
  }

  const body = await readFile(artifactPath).catch(() => null);
  if (!body) {
    return jsonError("Artifact not found", 404);
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": resolveContentType(requestedPath),
      "Content-Disposition": `inline; filename="${posix.basename(requestedPath)}"`,
    },
  });
}
