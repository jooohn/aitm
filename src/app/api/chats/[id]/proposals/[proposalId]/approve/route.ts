import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/backend/api/error-response";
import { getContainer } from "@/backend/container";

type Params = Promise<{ id: string; proposalId: string }>;

export async function POST(
  request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  try {
    const { chatService } = getContainer();
    const { id, proposalId } = await params;
    const body = await request.json().catch(() => ({}));
    const overrides =
      body.workflow_name || body.inputs
        ? {
            workflow_name: body.workflow_name as string | undefined,
            inputs: body.inputs as Record<string, string> | undefined,
          }
        : undefined;

    const result = await chatService.approveProposal(id, proposalId, overrides);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
