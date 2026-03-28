import { NextRequest, NextResponse } from "next/server";
import { getRepositoryByAlias, removeRepository } from "@/lib/repositories";

type Params = Promise<{ organization: string; name: string }>;

function errorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : "Internal server error";
  if (message.includes("not found"))
    return NextResponse.json({ error: message }, { status: 404 });
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  try {
    const { organization, name } = await params;
    const repo = getRepositoryByAlias(`${organization}/${name}`);
    if (!repo) {
      return NextResponse.json(
        { error: "Repository not found" },
        { status: 404 },
      );
    }
    removeRepository(repo.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
