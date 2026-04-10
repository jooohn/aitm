import { NextRequest, NextResponse } from "next/server";
import { processService, repositoryService } from "@/backend/container";

type Params = Promise<{
  organization: string;
  name: string;
  branch: string;
  processId: string;
}>;

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  const { organization, name, processId } = await params;
  const repo = await repositoryService.getRepositoryByAlias(
    `${organization}/${name}`,
  );
  if (!repo) {
    return NextResponse.json(
      { error: "Repository not found" },
      { status: 404 },
    );
  }

  const process = processService.getProcess(processId);
  if (!process) {
    return NextResponse.json({ error: "Process not found" }, { status: 404 });
  }

  return NextResponse.json(process);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  const { organization, name, processId } = await params;
  const repo = await repositoryService.getRepositoryByAlias(
    `${organization}/${name}`,
  );
  if (!repo) {
    return NextResponse.json(
      { error: "Repository not found" },
      { status: 404 },
    );
  }

  try {
    const process = await processService.stopProcess(processId);
    return NextResponse.json(process);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
