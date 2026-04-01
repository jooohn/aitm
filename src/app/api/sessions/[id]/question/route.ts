import { appendFileSync } from "fs";
import { NextRequest, NextResponse } from "next/server";
import { pendingQuestionService, sessionService } from "@/backend/container";
import { db } from "@/backend/infra/db";

type Params = Promise<{ id: string }>;

/**
 * Called by the MCP sidecar when Claude invokes AskUserQuestion.
 * Logs the question, sets the session to WAITING_FOR_INPUT, then holds
 * the connection open until the user submits an answer via
 * POST /api/sessions/{id}/messages.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  const { id } = await params;

  const session = sessionService.getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const body = await request.json();
  const question: string = body.question;
  if (!question?.trim()) {
    return NextResponse.json(
      { error: "question is required" },
      { status: 422 },
    );
  }

  // Log question and persist as a session message.
  appendFileSync(
    session.log_file_path,
    `${JSON.stringify({ type: "question", question })}\n`,
    "utf8",
  );
  sessionService.saveMessage(id, "agent", question);

  // Mark session as waiting.
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE sessions SET status = 'WAITING_FOR_INPUT', updated_at = ?
     WHERE id = ? AND status NOT IN ('SUCCEEDED', 'FAILED')`,
  ).run(now, id);

  let answer: string;
  try {
    answer = await pendingQuestionService.waitForAnswer(id);
  } catch {
    return NextResponse.json(
      { error: "Timed out waiting for answer" },
      { status: 504 },
    );
  }

  // Log answer.
  appendFileSync(
    session.log_file_path,
    `${JSON.stringify({ type: "answer", answer })}\n`,
    "utf8",
  );

  // Mark session as running again.
  db.prepare(
    `UPDATE sessions SET status = 'RUNNING', updated_at = ?
     WHERE id = ? AND status NOT IN ('SUCCEEDED', 'FAILED')`,
  ).run(new Date().toISOString(), id);

  return NextResponse.json({ answer });
}
