import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/backend/api/error-response";
import {
  parseJsonBody,
  resolveRepositoryFromParams,
} from "@/backend/api/request";
import { worktreeCreateBodySchema } from "@/backend/api/schemas";
import { getContainer } from "@/backend/container";
import { eventBus } from "@/backend/infra/event-bus";

type Params = Promise<{ organization: string; name: string }>;

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  try {
    const { worktreeService } = getContainer();
    const { organization, name } = await params;
    const repositoryResult = await resolveRepositoryFromParams({
      organization,
      name,
    });
    if (!repositoryResult.ok) {
      return repositoryResult.response;
    }
    return NextResponse.json(
      await worktreeService.listWorktrees(
        repositoryResult.data.repository.path,
      ),
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  try {
    const { worktreeService } = getContainer();
    const { organization, name } = await params;
    const repositoryResult = await resolveRepositoryFromParams({
      organization,
      name,
    });
    if (!repositoryResult.ok) {
      return repositoryResult.response;
    }

    const bodyResult = await parseJsonBody(request, worktreeCreateBodySchema);
    if (!bodyResult.ok) {
      return bodyResult.response;
    }

    const worktree = await worktreeService.createWorktree(
      repositoryResult.data.repository.path,
      bodyResult.data.branch,
      {
        name: bodyResult.data.name,
        no_fetch: bodyResult.data.no_fetch,
      },
    );
    eventBus.emit("worktree.changed", {
      repositoryOrganization: organization,
      repositoryName: name,
    });
    return NextResponse.json(worktree, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
