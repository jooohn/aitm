import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/backend/api/error-response";
import { resolveWorktreeFromBranchSlug } from "@/backend/api/request";
import { getContainer, processService } from "@/backend/container";
import { eventBus } from "@/backend/infra/event-bus";

type Params = Promise<{ organization: string; name: string; branch: string }>;

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  const { sessionService, worktreeService } = getContainer();
  try {
    const { organization, name, branch: branchSlug } = await params;
    const worktreeResult = await resolveWorktreeFromBranchSlug({
      organization,
      name,
      branch: branchSlug,
    });
    if (!worktreeResult.ok) {
      return worktreeResult.response;
    }

    const { repository, worktree } = worktreeResult.data;
    await processService.stopAllForWorktree(worktree.path, worktree.branch);
    await worktreeService.removeWorktree(repository.path, worktree.branch);
    await sessionService.deleteWorktreeData(repository.path, [worktree.branch]);
    eventBus.emit("worktree.changed", {
      repositoryOrganization: organization,
      repositoryName: name,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
