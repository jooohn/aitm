import { NextRequest, NextResponse } from "next/server";
import {
  parseJsonBody,
  resolveWorktreeFromBranchSlug,
} from "@/backend/api/request";
import { processCreateBodySchema } from "@/backend/api/schemas";
import { getContainer, processService } from "@/backend/container";

type Params = Promise<{ organization: string; name: string; branch: string }>;

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  const { organization, name, branch } = await params;
  const result = await resolveWorktreeFromBranchSlug({
    organization,
    name,
    branch,
  });
  if (!result.ok) return result.response;
  const processes = processService.listProcesses(
    result.data.worktree.path,
    result.data.worktree.branch,
  );
  return NextResponse.json(processes);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  const { repositoryService } = getContainer();
  const { organization, name, branch } = await params;
  const result = await resolveWorktreeFromBranchSlug({
    organization,
    name,
    branch,
  });
  if (!result.ok) return result.response;

  const bodyResult = await parseJsonBody(request, processCreateBodySchema, {
    invalidJsonStatus: 400,
    validationStatus: 400,
  });
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const alias = `${organization}/${name}`;
  const commands = repositoryService.getCommandsForAlias(alias);
  const matched = commands.find((c) => c.id === bodyResult.data.command_id);
  if (!matched) {
    return NextResponse.json(
      { error: `Command not found: "${bodyResult.data.command_id}"` },
      { status: 400 },
    );
  }

  const process = processService.startProcess(
    result.data.worktree.path,
    result.data.worktree.branch,
    matched,
    organization,
    name,
  );
  return NextResponse.json(process, { status: 201 });
}
