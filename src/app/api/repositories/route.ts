import { NextResponse } from "next/server";
import { listRepositories } from "@/lib/domain/repositories";

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(listRepositories());
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
