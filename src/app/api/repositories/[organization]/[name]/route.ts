import { NextRequest, NextResponse } from "next/server";
import { repositoryService } from "@/backend/container";

type Params = Promise<{ organization: string; name: string }>;

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
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
  const alias = `${organization}/${name}`;
  const github_url = await repositoryService.getGitHubUrl(repo.path);
  const commands = repositoryService
    .getCommandsForAlias(alias)
    .map((c) => ({ label: c.label }));
  return NextResponse.json({ ...repo, github_url, commands });
}
