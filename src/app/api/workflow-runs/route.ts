import { NextRequest, NextResponse } from "next/server";
import { toWorkflowRunDto } from "@/backend/api/dto";
import {
  flatMapApiResult,
  parseJsonBody,
  parseSearchParams,
  resolveOptionalRepositoryFilter,
  resolveRepositoryFromParams,
  tryApiResult,
} from "@/backend/api/request";
import {
  workflowRunCreateBodySchema,
  workflowRunListQuerySchema,
} from "@/backend/api/schemas";
import { getContainer } from "@/backend/container";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { workflowRunService } = getContainer();

  const bodyResult = await parseJsonBody(request, workflowRunCreateBodySchema, {
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
  });
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.data;

  const result = await flatMapApiResult(
    await resolveRepositoryFromParams(
      { organization: body.organization, name: body.name },
      { notFoundMessage: (alias) => `Repository ${alias} not found` },
    ),
    (repoData) =>
      tryApiResult(async () => {
        const run = await workflowRunService.createWorkflowRun({
          repository_path: repoData.repository.path,
          worktree_branch: body.worktree_branch,
          workflow_name: body.workflow_name,
          inputs: body.inputs,
        });
        return NextResponse.json(toWorkflowRunDto(run), { status: 201 });
      }),
  );
  if (!result.ok) return result.response;
  return result.data;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { workflowRunService } = getContainer();

  const result = await flatMapApiResult(
    parseSearchParams(request.nextUrl.searchParams, workflowRunListQuerySchema),
    async (query) => {
      return flatMapApiResult(
        await resolveOptionalRepositoryFilter(
          { organization: query.organization, name: query.name },
          { onMissingRepository: "empty-array" },
        ),
        (repoFilter) =>
          tryApiResult(async () =>
            NextResponse.json(
              workflowRunService
                .listWorkflowRuns({
                  repository_path: repoFilter.repositoryPath,
                  worktree_branch: query.worktree_branch,
                  status: query.status,
                })
                .map(toWorkflowRunDto),
            ),
          ),
      );
    },
  );
  if (!result.ok) return result.response;
  return result.data;
}
