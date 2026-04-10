import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/backend/api/error-response";
import {
  repositoryService,
  sessionService,
  worktreeService,
} from "@/backend/container";
import { eventBus } from "@/backend/infra/event-bus";

type Params = Promise<{ organization: string; name: string }>;

export async function POST(
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
    const removedBranches = await worktreeService.cleanMergedWorktrees(
      repo.path,
    );
    await sessionService.deleteWorktreeData(repo.path, removedBranches);
    if (removedBranches.length > 0) {
      eventBus.emit("worktree.changed", {
        repositoryOrganization: organization,
        repositoryName: name,
      });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
