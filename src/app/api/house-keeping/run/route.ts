import { NextResponse } from "next/server";
import { errorResponse } from "@/backend/api/error-response";
import { getContainer } from "@/backend/container";

export async function POST(): Promise<NextResponse> {
  try {
    const { houseKeepingService } = getContainer();
    await houseKeepingService.runAllRepositoriesOnce();
    return new NextResponse(null, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
