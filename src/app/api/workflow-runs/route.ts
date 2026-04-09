import { NextRequest, NextResponse } from "next/server";
import { toWorkflowRunDto } from "@/backend/api/dto";
import { repositoryService, workflowRunService } from "@/backend/container";
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
    const { organization, name, worktree_branch, workflow_name, inputs } = body;

    if (!organization || !name || !worktree_branch || !workflow_name) {
      return NextResponse.json(
        {
          error:
            "organization, name, worktree_branch, and workflow_name are required",
        },
        { status: 422 },
      );
    }

    const repo = await repositoryService.getRepositoryByAlias(
      `${organization}/${name}`,
    );
    if (!repo) {
      return NextResponse.json(
        { error: `Repository ${organization}/${name} not found` },
        { status: 404 },
      );
    }

    const run = await workflowRunService.createWorkflowRun({
      repository_path: repo.path,
      worktree_branch,
      workflow_name,
      inputs: inputs as Record<string, string> | undefined,
    });
    return NextResponse.json(toWorkflowRunDto(run), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = request.nextUrl;
    const organization = searchParams.get("organization") ?? undefined;
    const name = searchParams.get("name") ?? undefined;
    const worktree_branch = searchParams.get("worktree_branch") ?? undefined;
    const statusParam = searchParams.get("status") ?? undefined;
    const status = statusParam as WorkflowRunStatus | undefined;

    let repository_path: string | undefined;
    if (organization && name) {
      const repo = await repositoryService.getRepositoryByAlias(
        `${organization}/${name}`,
      );
      if (!repo) {
        return NextResponse.json([]);
      }
      repository_path = repo.path;
    }

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
