import { NextRequest, NextResponse } from "next/server";
import { toChatDto } from "@/backend/api/dto";
import { errorResponse } from "@/backend/api/error-response";
import { chatService, repositoryService } from "@/backend/container";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { organization, name } = body;

    if (!organization || !name) {
      return NextResponse.json(
        { error: "organization and name are required" },
        { status: 422 },
      );
    }

    const repo = await repositoryService.getRepositoryByAlias(
      `${organization}/${name}`,
    );
    if (!repo) {
      return NextResponse.json(
        { error: `Repository ${organization}/${name} not found` },
        { status: 404 },
      );
    }

    const chat = await chatService.createChat(repo.path);
    return NextResponse.json(toChatDto(chat), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = request.nextUrl;
    const organization = searchParams.get("organization") ?? undefined;
    const name = searchParams.get("name") ?? undefined;

    let repositoryPath: string | undefined;
    if (organization && name) {
      const repo = await repositoryService.getRepositoryByAlias(
        `${organization}/${name}`,
      );
      if (!repo) return NextResponse.json([]);
      repositoryPath = repo.path;
    }

    return NextResponse.json(
      chatService.listChats(repositoryPath).map(toChatDto),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
