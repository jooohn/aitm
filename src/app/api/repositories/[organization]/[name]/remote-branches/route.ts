import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/backend/api/error-response";
import { resolveRepositoryFromParams } from "@/backend/api/request";
import { getContainer } from "@/backend/container";

type Params = Promise<{ organization: string; name: string }>;

function parseGitHubOwnerRepo(
  url: string,
): { owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  try {
    const { repositoryService, gitHubBranchService } = getContainer();
    const { organization, name } = await params;
    const repositoryResult = await resolveRepositoryFromParams({
      organization,
      name,
    });
    if (!repositoryResult.ok) {
      return repositoryResult.response;
    }

    const githubUrl = await repositoryService.getGitHubUrl(
      repositoryResult.data.repository.path,
    );
    if (!githubUrl) {
      return NextResponse.json(
        { error: "No GitHub URL found for this repository" },
        { status: 400 },
      );
    }

    const parsed = parseGitHubOwnerRepo(githubUrl);
    if (!parsed) {
      return NextResponse.json(
        { error: `Could not parse GitHub owner/repo from URL: ${githubUrl}` },
        { status: 400 },
      );
    }

    const branches = await gitHubBranchService.fetchBranchesWithOpenPRs(
      parsed.owner,
      parsed.repo,
    );
    return NextResponse.json(branches);
  } catch (err) {
    return errorResponse(err);
  }
}
