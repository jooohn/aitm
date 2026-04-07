import { NextResponse } from "next/server";
import { toWorkflowDefinitionDto } from "@/backend/api/dto";
import { config } from "@/backend/container";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    Object.fromEntries(
      Object.entries(config.workflows).map(([name, workflow]) => [
        name,
        toWorkflowDefinitionDto(workflow),
      ]),
    ),
  );
}
