import { NextResponse } from "next/server";
import { getConfigWorkflows } from "@/backend/infra/config";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(await getConfigWorkflows());
}
