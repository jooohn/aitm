import { NextRequest, NextResponse } from "next/server";
import { toWorkflowRunDto } from "@/backend/api/dto";
import { workflowRunService } from "@/backend/container";
import type { WorkflowRunStatus } from "@/backend/domain/workflow-runs";

function errorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : "Internal server error";
  if (message.includes("not found") || message.includes("not found"))
    return NextResponse.json({ error: message }, { status: 404 });
  if (message.startsWith("Missing required input:"))
    return NextResponse.json({ error: message }, { status: 422 });
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { repository_path, worktree_branch, workflow_name, inputs } = body;

    if (!repository_path || !worktree_branch || !workflow_name) {
      return NextResponse.json(
        {
          error:
            "repository_path, worktree_branch, and workflow_name are required",
        },
        { status: 422 },
      );
    }

    const run = await workflowRunService.createWorkflowRun({
      repository_path,
      worktree_branch,
      workflow_name,
      inputs: inputs as Record<string, string> | undefined,
    });
    return NextResponse.json(toWorkflowRunDto(run), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export function GET(request: NextRequest): NextResponse {
  try {
    const { searchParams } = request.nextUrl;
    const repository_path = searchParams.get("repository_path") ?? undefined;
    const worktree_branch = searchParams.get("worktree_branch") ?? undefined;
    const statusParam = searchParams.get("status") ?? undefined;
    const status = statusParam as WorkflowRunStatus | undefined;

    return NextResponse.json(
      workflowRunService
        .listWorkflowRuns({
          repository_path,
          worktree_branch,
          status,
        })
        .map(toWorkflowRunDto),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
