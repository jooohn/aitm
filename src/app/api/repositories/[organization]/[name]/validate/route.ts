import { NextRequest, NextResponse } from "next/server";
import { getRepositoryByAlias, validateRepository } from "@/lib/repositories";

type Params = Promise<{ organization: string; name: string }>;

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  const { organization, name } = await params;
  const repo = getRepositoryByAlias(`${organization}/${name}`);
  if (!repo) {
    return NextResponse.json(
      { error: "Repository not found" },
      { status: 404 },
    );
  }
  return NextResponse.json(validateRepository(repo.path));
}
