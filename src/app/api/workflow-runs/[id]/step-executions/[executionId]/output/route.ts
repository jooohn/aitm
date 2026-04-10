import { readFile } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { extname, resolve, sep } from "path";
import { workflowRunService, worktreeService } from "@/backend/container";
import { resolveWorkflowRunDir } from "@/backend/domain/worktrees";

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

function resolveContentType(outputPath: string): string {
  switch (extname(outputPath).toLowerCase()) {
    case ".log":
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

type Params = Promise<{ id: string; executionId: string }>;

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  const { id, executionId } = await params;
  const run = await workflowRunService.getWorkflowRunForDisplay(id);
  if (!run) {
    return jsonError("Workflow run not found", 404);
  }

  const execution = run.step_executions.find((item) => item.id === executionId);
  if (
    !execution ||
    execution.step_type !== "command" ||
    !execution.output_file_path
  ) {
    return jsonError("Command output not found", 404);
  }

  const worktree = await worktreeService.findWorktree(
    run.repository_path,
    run.worktree_branch,
  );
  if (!worktree) {
    return jsonError("Worktree not found", 404);
  }

  const outputPath = resolve(execution.output_file_path);
  const runDir = resolve(resolveWorkflowRunDir(worktree, run.id));
  const allowedRoot = `${runDir}${sep}`;
  if (outputPath !== runDir && !outputPath.startsWith(allowedRoot)) {
    return jsonError("Invalid command output path", 400);
  }

  const body = await readFile(outputPath).catch(() => null);
  if (!body) {
    return jsonError("Command output not found", 404);
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": resolveContentType(outputPath),
    },
  });
}
