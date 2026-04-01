import { NextResponse } from "next/server";
import { repositoryService } from "@/lib/container";

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(repositoryService.listRepositories());
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
