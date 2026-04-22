import { NextRequest, NextResponse } from "next/server";
import { toWorkflowDefinitionDto } from "@/backend/api/dto";
import { getContainer } from "@/backend/container";
import { filterWorkflowsForRepository } from "@/backend/domain/workflows/filter";

type Params = Promise<{ organization: string; name: string }>;

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  const { repositoryService, config } = getContainer();
  const { organization, name } = await params;
  const alias = `${organization}/${name}`;
  const repo = await repositoryService.getRepositoryByAlias(alias);
  if (!repo) {
    return NextResponse.json(
      { error: "Repository not found" },
      { status: 404 },
    );
  }
  const configRepo = repositoryService.getConfigForAlias(alias);
  const github_url = await repositoryService.getGitHubUrl(repo.path);
  const commands = repositoryService
    .getCommandsForAlias(alias)
    .map((c) => ({ id: c.id, label: c.label }));
  const filtered = filterWorkflowsForRepository(config.workflows, configRepo);
  const workflows = Object.fromEntries(
    Object.entries(filtered).map(([k, v]) => [k, toWorkflowDefinitionDto(v)]),
  );
  return NextResponse.json({ ...repo, github_url, commands, workflows });
}
