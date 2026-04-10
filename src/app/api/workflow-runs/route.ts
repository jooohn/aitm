import { NextRequest, NextResponse } from "next/server";
import { toWorkflowRunDto } from "@/backend/api/dto";
import { errorResponse } from "@/backend/api/error-response";
import {
  parseJsonBody,
  parseSearchParams,
  resolveOptionalRepositoryFilter,
  resolveRepositoryFromParams,
} from "@/backend/api/request";
import {
  workflowRunCreateBodySchema,
  workflowRunListQuerySchema,
} from "@/backend/api/schemas";
import { workflowRunService } from "@/backend/container";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const bodyResult = await parseJsonBody(
      request,
      workflowRunCreateBodySchema,
      {
        formatError: (error) => {
          const firstIssue = error.issues[0];
          const path = firstIssue?.path[0];
          if (
            path === "organization" ||
            path === "name" ||
            path === "worktree_branch" ||
            path === "workflow_name"
          ) {
            return "organization, name, worktree_branch, and workflow_name are required";
          }
          if (path === "inputs") {
            return "inputs must be an object with string values";
          }
          return firstIssue?.message ?? "Invalid JSON body";
        },
      },
    );
    if (!bodyResult.ok) {
      return bodyResult.response;
    }

    const repositoryResult = await resolveRepositoryFromParams(
      {
        organization: bodyResult.data.organization,
        name: bodyResult.data.name,
      },
      {
        notFoundMessage: (alias) => `Repository ${alias} not found`,
      },
    );
    if (!repositoryResult.ok) {
      return repositoryResult.response;
    }

    const run = await workflowRunService.createWorkflowRun({
      repository_path: repositoryResult.data.repository.path,
      worktree_branch: bodyResult.data.worktree_branch,
      workflow_name: bodyResult.data.workflow_name,
      inputs: bodyResult.data.inputs,
    });
    return NextResponse.json(toWorkflowRunDto(run), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const queryResult = parseSearchParams(
      request.nextUrl.searchParams,
      workflowRunListQuerySchema,
    );
    if (!queryResult.ok) {
      return queryResult.response;
    }

    const repositoryResult = await resolveOptionalRepositoryFilter(
      {
        organization: queryResult.data.organization,
        name: queryResult.data.name,
      },
      {
        onMissingRepository: "empty-array",
      },
    );
    if (!repositoryResult.ok) {
      return repositoryResult.response;
    }

    return NextResponse.json(
      workflowRunService
        .listWorkflowRuns({
          repository_path: repositoryResult.data.repositoryPath,
          worktree_branch: queryResult.data.worktree_branch,
          status: queryResult.data.status,
        })
        .map(toWorkflowRunDto),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
