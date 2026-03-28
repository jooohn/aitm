import { NextRequest, NextResponse } from "next/server";
import { removeRepository } from "@/lib/repositories";

function errorResponse(err: unknown): NextResponse {
	const message = err instanceof Error ? err.message : "Internal server error";
	if (message.includes("not found"))
		return NextResponse.json({ error: message }, { status: 404 });
	return NextResponse.json({ error: message }, { status: 500 });
}

export async function DELETE(
	_request: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
	try {
		const { id } = await params;
		removeRepository(Number(id));
		return NextResponse.json({ success: true });
	} catch (err) {
		return errorResponse(err);
	}
}
