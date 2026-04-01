import { NextResponse } from "next/server";
import { getConfigWorkflows } from "@/backend/infra/config";

export function GET(): NextResponse {
  return NextResponse.json(getConfigWorkflows());
}
