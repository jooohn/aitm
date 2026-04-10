import { NextResponse } from "next/server";
import { errorResponse } from "@/backend/api/error-response";
import { repositoryService } from "@/backend/container";

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(await repositoryService.listRepositories());
  } catch (err) {
    return errorResponse(err);
  }
}
