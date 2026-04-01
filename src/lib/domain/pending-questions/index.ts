/**
 * In-memory registry for MCP-path questions waiting for a user answer.
 *
 * When the MCP server calls POST /api/sessions/{id}/question, the route
 * registers a resolver here and holds the HTTP connection open.  When the
 * user submits an answer via POST /api/sessions/{id}/messages, the resolver
 * is called and the MCP server's long-poll returns.
 */

export class PendingQuestionService {
  private pending = new Map<string, (answer: string) => void>();

  /** Register a pending question for sessionId. Resolves when the user answers. */
  waitForAnswer(
    sessionId: string,
    timeoutMs = 10 * 60 * 1000,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(sessionId);
        reject(new Error("Question timed out waiting for user input"));
      }, timeoutMs);

      this.pending.set(sessionId, (answer) => {
        clearTimeout(timer);
        resolve(answer);
      });
    });
  }

  /** Deliver the user's answer, returns true if there was a pending question. */
  deliverAnswer(sessionId: string, answer: string): boolean {
    const resolve = this.pending.get(sessionId);
    if (!resolve) return false;
    this.pending.delete(sessionId);
    resolve(answer);
    return true;
  }

  hasPendingQuestion(sessionId: string): boolean {
    return this.pending.has(sessionId);
  }
}
