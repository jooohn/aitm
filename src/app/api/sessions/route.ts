import { NextRequest, NextResponse } from "next/server";
import { toSessionDto } from "@/backend/api/dto";
import { errorResponse } from "@/backend/api/error-response";
import {
  parseSearchParams,
  resolveOptionalRepositoryFilter,
} from "@/backend/api/request";
import { sessionListQuerySchema } from "@/backend/api/schemas";
import { sessionService } from "@/backend/container";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const queryResult = parseSearchParams(
      request.nextUrl.searchParams,
      sessionListQuerySchema,
    );
    if (!queryResult.ok) {
      return queryResult.response;
    }

    const repositoryResult = await resolveOptionalRepositoryFilter(
      {
        organization: queryResult.data.organization,
        name: queryResult.data.name,
      },
      {
        onMissingRepository: "empty-array",
      },
    );
    if (!repositoryResult.ok) {
      return repositoryResult.response;
    }

    return NextResponse.json(
      sessionService
        .listSessions({
          repository_path: repositoryResult.data.repositoryPath,
          worktree_branch: queryResult.data.worktree_branch,
          status: queryResult.data.status,
        })
        .map(toSessionDto),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
