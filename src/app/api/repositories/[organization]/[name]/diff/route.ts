import { NextRequest, NextResponse } from "next/server";
import { repositoryService, worktreeService } from "@/backend/container";
import type { DiffFile } from "@/backend/domain/worktrees/diff";
import type { DiffFileDto, DiffResponseDto } from "@/shared/contracts/api";

type Params = Promise<{ organization: string; name: string }>;

function toDiffFileDto(file: DiffFile): DiffFileDto {
  return {
    path: file.path,
    old_path: file.oldPath,
    status: file.status,
    hunks: file.hunks.map((hunk) => ({
      header: hunk.header,
      lines: hunk.lines.map((line) => ({
        type: line.type,
        content: line.content,
        old_line: line.oldLine,
        new_line: line.newLine,
      })),
    })),
  };
}

export async function GET(
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

    const branch = request.nextUrl.searchParams.get("branch");
    if (!branch) {
      return NextResponse.json(
        { error: "Missing required query parameter: branch" },
        { status: 400 },
      );
    }

    const worktree = await worktreeService.findWorktree(repo.path, branch);
    if (!worktree) {
      return NextResponse.json(
        { error: `Worktree not found for branch: ${branch}` },
        { status: 404 },
      );
    }

    const base = request.nextUrl.searchParams.get("base") || undefined;
    const files = await worktreeService.getDiff(worktree.path, base);

    const response: DiffResponseDto = {
      files: files.map(toDiffFileDto),
    };
    return NextResponse.json(response);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
