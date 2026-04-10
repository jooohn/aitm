import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/backend/api/error-response";
import {
  processService,
  repositoryService,
  sessionService,
  worktreeService,
} from "@/backend/container";
import { eventBus } from "@/backend/infra/event-bus";
import { branchToSlug } from "@/lib/utils/branch-slug";

type Params = Promise<{ organization: string; name: string; branch: string }>;

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  try {
    const { organization, name, branch: branchSlug } = await params;
    const repo = await repositoryService.getRepositoryByAlias(
      `${organization}/${name}`,
    );
    if (!repo) {
      return NextResponse.json(
        { error: "Repository not found" },
        { status: 404 },
      );
    }
    const worktrees = await worktreeService.listWorktrees(repo.path);
    const worktree = worktrees.find(
      (w) => branchToSlug(w.branch) === branchSlug,
    );
    if (!worktree) {
      return NextResponse.json(
        { error: "Worktree not found" },
        { status: 404 },
      );
    }
    const branchName = worktree.branch;
    await processService.stopAllForWorktree(worktree.path, branchName);
    await worktreeService.removeWorktree(repo.path, branchName);
    await sessionService.deleteWorktreeData(repo.path, [branchName]);
    eventBus.emit("worktree.changed", {
      repositoryOrganization: organization,
      repositoryName: name,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
