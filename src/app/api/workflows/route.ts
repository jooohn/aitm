import { NextResponse } from "next/server";
import { toWorkflowDefinitionDto } from "@/backend/api/dto";
import { getConfigWorkflows } from "@/backend/infra/config";

export async function GET(): Promise<NextResponse> {
  const workflows = await getConfigWorkflows();
  return NextResponse.json(
    Object.fromEntries(
      Object.entries(workflows).map(([name, workflow]) => [
        name,
        toWorkflowDefinitionDto(workflow),
      ]),
    ),
  );
}
