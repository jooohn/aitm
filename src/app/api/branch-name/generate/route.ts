import { NextResponse } from "next/server";
import { BranchNameService } from "@/backend/domain/branch-name";

const branchNameService = new BranchNameService();

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every(
    (v) => typeof v === "string",
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 422 });
  }
  const { workflow_name, inputs } = body as Record<string, unknown>;

  if (typeof workflow_name !== "string" || !workflow_name) {
    return NextResponse.json(
      { error: "workflow_name is required" },
      { status: 422 },
    );
  }

  if (inputs != null && !isStringRecord(inputs)) {
    return NextResponse.json(
      { error: "inputs must be an object with string values" },
      { status: 422 },
    );
  }

  const branch = branchNameService.generate(
    workflow_name,
    isStringRecord(inputs) ? inputs : {},
  );

  return NextResponse.json({ branch });
}
