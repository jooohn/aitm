/**
 * In-memory registry for MCP-path questions waiting for a user answer.
 *
 * When the MCP server calls POST /api/sessions/{id}/question, the route
 * registers a resolver here and holds the HTTP connection open.  When the
 * user submits an answer via POST /api/sessions/{id}/messages, the resolver
 * is called and the MCP server's long-poll returns.
 */

const pending = new Map<string, (answer: string) => void>();

/** Register a pending question for sessionId. Resolves when the user answers. */
export function waitForAnswer(
  sessionId: string,
  timeoutMs = 10 * 60 * 1000,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(sessionId);
      reject(new Error("Question timed out waiting for user input"));
    }, timeoutMs);

    pending.set(sessionId, (answer) => {
      clearTimeout(timer);
      resolve(answer);
    });
  });
}

/** Deliver the user's answer, returns true if there was a pending question. */
export function deliverAnswer(sessionId: string, answer: string): boolean {
  const resolve = pending.get(sessionId);
  if (!resolve) return false;
  pending.delete(sessionId);
  resolve(answer);
  return true;
}

export function hasPendingQuestion(sessionId: string): boolean {
  return pending.has(sessionId);
}
