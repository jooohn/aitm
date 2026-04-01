import { AbortError, type CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import type { AskUserQuestionInput } from "@anthropic-ai/claude-agent-sdk/sdk-tools";
import { appendFileSync, writeFileSync } from "fs";
import type { SessionStatus } from "@/backend/domain/sessions";
import type { AgentConfig, WorkflowTransition } from "@/backend/infra/config";
import { db } from "@/backend/infra/db";
import { claudeCLI } from "./claude-cli";
import { codexSDK } from "./codex-sdk";
import type { AgentRuntime } from "./runtime";

export interface TransitionDecision {
  transition: string;
  reason: string;
  handoff_summary: string;
}

type PendingInput = {
  resolve: (answer: string) => void;
  reject: (err: Error) => void;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function appendToLog(logFilePath: string, entry: unknown): void {
  try {
    appendFileSync(logFilePath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // Non-critical — ignore log write errors.
  }
}

function setStatus(sessionId: string, status: SessionStatus): void {
  const now = new Date().toISOString();
  // Guard against races: never overwrite a terminal status set by another path.
  db.prepare(
    `UPDATE sessions SET status = ?, updated_at = ?
     WHERE id = ? AND status NOT IN ('SUCCEEDED', 'FAILED')`,
  ).run(status, now, sessionId);
}

function setAgentSession(
  sessionId: string,
  agentSessionId: string | null,
  attachCommand: string | null,
): void {
  db.prepare(
    `UPDATE sessions
     SET claude_session_id = ?, terminal_attach_command = ?
     WHERE id = ?`,
  ).run(agentSessionId, attachCommand, sessionId);
}

function getSessionStatus(sessionId: string): SessionStatus | null {
  const row = db
    .prepare("SELECT status FROM sessions WHERE id = ?")
    .get(sessionId) as { status: SessionStatus } | undefined;
  return row?.status ?? null;
}

function isTerminalSessionStatus(status: SessionStatus | null): boolean {
  return status === "FAILED" || status === "SUCCEEDED";
}

function buildTransitionsSection(transitions: WorkflowTransition[]): string {
  const list = transitions
    .map((t) => {
      const name =
        "state" in t
          ? t.state
          : (t as { terminal: string; when: string }).terminal;
      return `  - "${name}": ${t.when}`;
    })
    .join("\n");

  return [
    "<transitions>",
    "When you finish your work, evaluate which transition applies and emit it as your final structured output.",
    "Available transitions (emit the exact transition name in the 'transition' field):",
    list,
    "</transitions>",
  ].join("\n");
}

/** Callback interface for saving messages — avoids circular dependency with SessionService. */
export interface AgentMessageSink {
  saveMessage(sessionId: string, role: "user" | "agent", content: string): void;
}

export class AgentService {
  // Keyed by our session ID — both survive only for the current process lifetime.
  private pendingInputs = new Map<string, PendingInput>();
  private activeAbortControllers = new Map<string, AbortController>();

  constructor(private messageSink: AgentMessageSink) {}

  private finishEarly(
    sessionId: string,
    onComplete?: (decision: TransitionDecision | null) => void,
  ): void {
    this.activeAbortControllers.delete(sessionId);
    this.pendingInputs.delete(sessionId);
    onComplete?.(null);
  }

  private createToolPermissionHandler(
    sessionId: string,
    logFilePath: string,
  ): CanUseTool {
    return async (toolName, input, { signal }) => {
      if (toolName === "AskUserQuestion") {
        const qi = input as unknown as AskUserQuestionInput;

        // Flatten questions into a human-readable message.
        const questionText = qi.questions
          .map((q) =>
            [
              q.question,
              q.options
                .map((o) => `  - ${o.label}: ${o.description}`)
                .join("\n"),
            ].join("\n"),
          )
          .join("\n\n");

        appendToLog(logFilePath, { type: "question", question: questionText });
        this.messageSink.saveMessage(sessionId, "agent", questionText);
        setStatus(sessionId, "WAITING_FOR_INPUT");

        try {
          const answer = await this.waitForInput(sessionId, signal);
          setStatus(sessionId, "RUNNING");
          appendToLog(logFilePath, { type: "answer", answer });

          // Return the user's answer keyed by question text.
          const answers = Object.fromEntries(
            qi.questions.map((q) => [q.question, answer]),
          );
          return { behavior: "allow", updatedInput: { ...input, answers } };
        } catch {
          return {
            behavior: "deny",
            message: "Session cancelled or interrupted",
          };
        }
      }

      // Auto-approve everything else.
      return { behavior: "allow", updatedInput: input };
    };
  }

  private waitForInput(
    sessionId: string,
    signal: AbortSignal,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new AbortError());
        return;
      }

      const onAbort = () => {
        this.pendingInputs.delete(sessionId);
        reject(new AbortError());
      };
      signal.addEventListener("abort", onAbort, { once: true });

      this.pendingInputs.set(sessionId, {
        resolve: (answer) => {
          signal.removeEventListener("abort", onAbort);
          resolve(answer);
        },
        reject,
      });
    });
  }

  /**
   * Start a configured agent runtime for a session. Fire-and-forget — call without
   * awaiting. All errors are handled internally; the session is marked FAILED
   * if anything goes wrong. Calls onComplete with the structured transition
   * decision when the session ends (null if the session failed or produced no output).
   */
  async startAgent(
    sessionId: string,
    cwd: string,
    goal: string,
    transitions: WorkflowTransition[],
    agentConfig: AgentConfig,
    logFilePath: string,
    onComplete?: (decision: TransitionDecision | null) => void,
  ): Promise<void> {
    const abortController = new AbortController();
    this.activeAbortControllers.set(sessionId, abortController);

    // Yield to the event loop so createSession can return the RUNNING record
    // before any synchronous work here (like worktree lookup) can change status.
    await Promise.resolve();

    if (
      abortController.signal.aborted ||
      isTerminalSessionStatus(getSessionStatus(sessionId))
    ) {
      this.finishEarly(sessionId, onComplete);
      return;
    }

    try {
      writeFileSync(logFilePath, "", "utf8");
    } catch {
      // Non-critical — subsequent append attempts are already best-effort.
    }

    const agentRuntime: AgentRuntime =
      agentConfig.provider === "codex" ? codexSDK : claudeCLI;

    const prompt = [
      goal,
      "",
      buildTransitionsSection(transitions),
      "",
      "Use the AskUserQuestion tool if you need clarification from the user.",
    ].join("\n");

    const canUseTool = this.createToolPermissionHandler(sessionId, logFilePath);

    let decision: TransitionDecision | null = null;
    try {
      if (
        abortController.signal.aborted ||
        isTerminalSessionStatus(getSessionStatus(sessionId))
      ) {
        this.finishEarly(sessionId, onComplete);
        return;
      }

      for await (const message of agentRuntime.query({
        sessionId,
        prompt,
        cwd,
        command: agentConfig.command,
        model: agentConfig.model,
        permissionMode: "acceptEdits",
        abortController,
        canUseTool,
        outputFormat: agentRuntime.buildTransitionOutputFormat(transitions),
      })) {
        appendToLog(logFilePath, message);

        if (message.type === "system" && message.subtype === "init") {
          const attachCommand =
            message.attach_command ??
            (message.session_id
              ? agentConfig.provider === "codex"
                ? `codex resume ${message.session_id}`
                : `claude --resume ${message.session_id}`
              : null);
          setAgentSession(sessionId, message.session_id ?? null, attachCommand);
        }

        if (message.type === "result") {
          if (message.subtype === "success" && message.structured_output) {
            decision = message.structured_output as TransitionDecision;
            db.prepare(
              "UPDATE sessions SET transition_decision = ? WHERE id = ?",
            ).run(JSON.stringify(decision), sessionId);
          }
          setStatus(
            sessionId,
            message.subtype === "success" ? "SUCCEEDED" : "FAILED",
          );
        }
      }
    } catch (err) {
      if (!(err instanceof AbortError)) {
        appendToLog(logFilePath, {
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
        setStatus(sessionId, "FAILED");
      }
    } finally {
      this.activeAbortControllers.delete(sessionId);
      this.pendingInputs.delete(sessionId);
    }

    // Ensure the session always reaches a terminal state.
    // The guard in setStatus prevents overwriting SUCCEEDED or FAILED.
    // This handles cases where the CLI exits without producing a result message
    // (e.g., empty stdout, unrecognised flags) or when an AbortError is thrown
    // without a prior explicit failSession() call.
    setStatus(sessionId, "FAILED");

    onComplete?.(decision);
  }

  /**
   * Deliver a user reply to a session that is WAITING_FOR_INPUT.
   * Resolves the pending canUseTool promise so the agent resumes.
   */
  sendMessageToAgent(sessionId: string, answer: string): void {
    const pending = this.pendingInputs.get(sessionId);
    if (pending) {
      this.pendingInputs.delete(sessionId);
      pending.resolve(answer);
    }
  }

  /**
   * Abort a running agent. Rejects any pending input promise and signals the
   * AbortController so the for-await loop exits.
   */
  cancelAgent(sessionId: string): void {
    const pending = this.pendingInputs.get(sessionId);
    if (pending) {
      this.pendingInputs.delete(sessionId);
      pending.reject(new AbortError());
    }
    const controller = this.activeAbortControllers.get(sessionId);
    if (controller) {
      this.activeAbortControllers.delete(sessionId);
      controller.abort();
    }
  }
}
