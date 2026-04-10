import { NextResponse } from "next/server";
import { errorResponse } from "@/backend/api/error-response";
import { getContainer } from "@/backend/container";

export async function GET(): Promise<NextResponse> {
  try {
    const { repositoryService } = getContainer();
    return NextResponse.json(await repositoryService.listRepositories());
  } catch (err) {
    return errorResponse(err);
  }
}
