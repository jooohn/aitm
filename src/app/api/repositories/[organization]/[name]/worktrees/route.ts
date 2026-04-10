import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/backend/api/error-response";
import { repositoryService, worktreeService } from "@/backend/container";
import { eventBus } from "@/backend/infra/event-bus";

type Params = Promise<{ organization: string; name: string }>;

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  try {
    const { organization, name } = await params;
    const repo = await repositoryService.getRepositoryByAlias(
      `${organization}/${name}`,
    );
    if (!repo) {
      return NextResponse.json(
        { error: "Repository not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(await worktreeService.listWorktrees(repo.path));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  try {
    const { organization, name } = await params;
    const repo = await repositoryService.getRepositoryByAlias(
      `${organization}/${name}`,
    );
    if (!repo) {
      return NextResponse.json(
        { error: "Repository not found" },
        { status: 404 },
      );
    }
    const body = await request.json();
    const worktree = await worktreeService.createWorktree(
      repo.path,
      body.branch,
      {
        name: body.name,
        no_fetch: body.no_fetch,
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
