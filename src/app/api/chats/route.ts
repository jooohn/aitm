import { NextRequest, NextResponse } from "next/server";
import { toChatDto } from "@/backend/api/dto";
import { errorResponse } from "@/backend/api/error-response";
import {
  parseJsonBody,
  parseSearchParams,
  resolveOptionalRepositoryFilter,
  resolveRepositoryFromParams,
} from "@/backend/api/request";
import {
  chatCreateBodySchema,
  chatListQuerySchema,
} from "@/backend/api/schemas";
import { chatService } from "@/backend/container";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const bodyResult = await parseJsonBody(request, chatCreateBodySchema, {
      formatError: (error) => {
        const fields = error.issues
          .map((issue) => issue.path[0])
          .filter((field): field is string => typeof field === "string");
        if (fields.includes("organization") || fields.includes("name")) {
          return "organization and name are required";
        }
        return error.issues[0]?.message ?? "Invalid JSON body";
      },
    });
    if (!bodyResult.ok) {
      return bodyResult.response;
    }

    const { organization, name } = bodyResult.data;
    const repositoryResult = await resolveRepositoryFromParams(
      { organization, name },
      {
        notFoundMessage: (alias) => `Repository ${alias} not found`,
      },
    );
    if (!repositoryResult.ok) {
      return repositoryResult.response;
    }

    const chat = await chatService.createChat(
      repositoryResult.data.repository.path,
    );
    return NextResponse.json(toChatDto(chat), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const queryResult = parseSearchParams(
      request.nextUrl.searchParams,
      chatListQuerySchema,
    );
    if (!queryResult.ok) {
      return queryResult.response;
    }

    const repositoryResult = await resolveOptionalRepositoryFilter(
      queryResult.data,
      {
        onMissingRepository: "empty-array",
      },
    );
    if (!repositoryResult.ok) {
      return repositoryResult.response;
    }

    return NextResponse.json(
      chatService
        .listChats(repositoryResult.data.repositoryPath)
        .map(toChatDto),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
