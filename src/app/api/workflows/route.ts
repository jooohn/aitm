import { NextResponse } from "next/server";
import { getConfigWorkflows } from "@/lib/infra/config";

export function GET(): NextResponse {
  return NextResponse.json(getConfigWorkflows());
}
