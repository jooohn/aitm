import { NextRequest, NextResponse } from "next/server";
import { repositoryService } from "@/backend/container";

type Params = Promise<{ organization: string; name: string }>;

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  const { organization, name } = await params;
  const repo = repositoryService.getRepositoryByAlias(
    `${organization}/${name}`,
  );
  if (!repo) {
    return NextResponse.json(
      { error: "Repository not found" },
      { status: 404 },
    );
  }
  return NextResponse.json(repositoryService.validateRepository(repo.path));
}
