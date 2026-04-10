import { NextResponse } from "next/server";
import { parseJsonBody } from "@/backend/api/request";
import { branchNameGenerateBodySchema } from "@/backend/api/schemas";
import { BranchNameService } from "@/backend/domain/branch-name";

const branchNameService = new BranchNameService();

export async function POST(request: Request): Promise<NextResponse> {
  const bodyResult = await parseJsonBody(
    request,
    branchNameGenerateBodySchema,
    {
      formatError: (error) => {
        const firstIssue = error.issues[0];
        if (firstIssue?.path[0] === "inputs") {
          return "inputs must be an object with string values";
        }
        return firstIssue?.message ?? "Invalid JSON body";
      },
    },
  );
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const branch = branchNameService.generate(
    bodyResult.data.workflow_name,
    bodyResult.data.inputs ?? {},
  );

  return NextResponse.json({ branch });
}
