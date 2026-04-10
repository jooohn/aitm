import { NextRequest, NextResponse } from "next/server";
import {
  processService,
  repositoryService,
  worktreeService,
} from "@/backend/container";
import { branchToSlug } from "@/lib/utils/branch-slug";

type Params = Promise<{ organization: string; name: string; branch: string }>;

async function resolveWorktreePath(
  organization: string,
  name: string,
  branchSlug: string,
): Promise<
  | { ok: true; worktreePath: string; branchName: string }
  | { ok: false; response: NextResponse }
> {
  const repo = await repositoryService.getRepositoryByAlias(
    `${organization}/${name}`,
  );
  if (!repo) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Repository not found" },
        { status: 404 },
      ),
    };
  }
  const worktrees = await worktreeService.listWorktrees(repo.path);
  const worktree = worktrees.find((w) => branchToSlug(w.branch) === branchSlug);
  if (!worktree) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Worktree not found" },
        { status: 404 },
      ),
    };
  }
  return { ok: true, worktreePath: worktree.path, branchName: worktree.branch };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  const { organization, name, branch } = await params;
  const result = await resolveWorktreePath(organization, name, branch);
  if (!result.ok) return result.response;
  const processes = processService.listProcesses(
    result.worktreePath,
    result.branchName,
  );
  return NextResponse.json(processes);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  const { organization, name, branch } = await params;
  const result = await resolveWorktreePath(organization, name, branch);
  if (!result.ok) return result.response;

  const body = await request.json();
  const commandLabel = body.command_label?.trim();
  if (!commandLabel) {
    return NextResponse.json(
      { error: "command_label is required and must be non-empty" },
      { status: 400 },
    );
  }

  const alias = `${organization}/${name}`;
  const commands = repositoryService.getCommandsForAlias(alias);
  const matched = commands.find((c) => c.label === commandLabel);
  if (!matched) {
    return NextResponse.json(
      { error: `Command not found: "${commandLabel}"` },
      { status: 400 },
    );
  }

  const process = processService.startProcess(
    result.worktreePath,
    result.branchName,
    matched.command,
    organization,
    name,
  );
  return NextResponse.json(process, { status: 201 });
}
