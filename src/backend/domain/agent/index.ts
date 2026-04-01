import { AbortError } from "@anthropic-ai/claude-agent-sdk";
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

export class AgentService {
  private activeAbortControllers = new Map<string, AbortController>();

  private finishEarly(
    sessionId: string,
    onComplete?: (decision: TransitionDecision | null) => void,
  ): void {
    this.activeAbortControllers.delete(sessionId);
    onComplete?.(null);
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

    const prompt = [goal, "", buildTransitionsSection(transitions)].join("\n");

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
   * Abort a running agent. Signals the AbortController so the for-await loop exits.
   */
  cancelAgent(sessionId: string): void {
    const controller = this.activeAbortControllers.get(sessionId);
    if (controller) {
      this.activeAbortControllers.delete(sessionId);
      controller.abort();
    }
  }
}
