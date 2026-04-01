import { AbortError } from "@anthropic-ai/claude-agent-sdk";
import { appendFileSync, writeFileSync } from "fs";
import type { SessionStatus } from "@/backend/domain/sessions";
import type { AgentConfig, WorkflowTransition } from "@/backend/infra/config";
import { db } from "@/backend/infra/db";
import { claudeCLI } from "./claude-cli";
import { codexSDK } from "./codex-sdk";
import type { AgentMessage, AgentRuntime, SessionTransition } from "./runtime";
import { USER_INPUT_TRANSITION, USER_INPUT_TRANSITION_NAME } from "./runtime";

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

function getAgentSessionId(sessionId: string): string | null {
  const row = db
    .prepare("SELECT claude_session_id FROM sessions WHERE id = ?")
    .get(sessionId) as { claude_session_id: string | null } | undefined;
  return row?.claude_session_id ?? null;
}

function isTerminalSessionStatus(status: SessionStatus | null): boolean {
  return status === "FAILED" || status === "SUCCEEDED";
}

function buildSessionTransitions(
  transitions: WorkflowTransition[],
): SessionTransition[] {
  return [...transitions, USER_INPUT_TRANSITION];
}

function buildTransitionsSection(transitions: SessionTransition[]): string {
  const list = transitions
    .map((t) => {
      let name: string;
      if ("user_input" in t) {
        name = USER_INPUT_TRANSITION_NAME;
      } else if ("state" in t) {
        name = t.state;
      } else {
        name = t.terminal;
      }
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

function selectRuntime(agentConfig: AgentConfig): AgentRuntime {
  return agentConfig.provider === "codex" ? codexSDK : claudeCLI;
}

/** Process messages from an agent stream. Returns the transition decision if one was produced. */
function processResultMessage(
  sessionId: string,
  message: AgentMessage & { type: "result" },
): TransitionDecision | null {
  let decision: TransitionDecision | null = null;
  if (message.subtype === "success" && message.structured_output) {
    decision = message.structured_output as TransitionDecision;
    db.prepare("UPDATE sessions SET transition_decision = ? WHERE id = ?").run(
      JSON.stringify(decision),
      sessionId,
    );
  }
  return decision;
}

function isUserInputTransition(decision: TransitionDecision | null): boolean {
  return decision?.transition === USER_INPUT_TRANSITION_NAME;
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
   * if anything goes wrong.
   *
   * If the agent selects __REQUIRE_USER_INPUT__, the session is set to
   * AWAITING_INPUT and the function returns without calling onComplete.
   * Call resumeAgent() when the user provides input.
   *
   * onComplete is called with the structured transition decision when the
   * session ends with a real transition (not __REQUIRE_USER_INPUT__), or null
   * on failure.
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

    const agentRuntime = selectRuntime(agentConfig);
    const sessionTransitions = buildSessionTransitions(transitions);
    const prompt = [goal, "", buildTransitionsSection(sessionTransitions)].join(
      "\n",
    );
    const outputFormat =
      agentRuntime.buildTransitionOutputFormat(sessionTransitions);

    let decision: TransitionDecision | null = null;
    try {
      if (
        abortController.signal.aborted ||
        isTerminalSessionStatus(getSessionStatus(sessionId))
      ) {
        this.finishEarly(sessionId, onComplete);
        return;
      }

      decision = await this.consumeAgentStream(
        agentRuntime.query({
          sessionId,
          prompt,
          cwd,
          command: agentConfig.command,
          model: agentConfig.model,
          permissionMode: "acceptEdits",
          abortController,
          outputFormat,
        }),
        sessionId,
        logFilePath,
        agentConfig,
      );
    } catch (err) {
      if (!(err instanceof AbortError)) {
        appendToLog(logFilePath, {
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
      setStatus(sessionId, "FAILED");
      this.activeAbortControllers.delete(sessionId);
      onComplete?.(null);
      return;
    }

    this.activeAbortControllers.delete(sessionId);
    this.handleDecision(sessionId, decision, logFilePath, onComplete);
  }

  /**
   * Resume a session that is awaiting user input. Fire-and-forget — call
   * without awaiting. Behaves like startAgent for the result handling:
   * if the agent selects __REQUIRE_USER_INPUT__ again, AWAITING_INPUT is
   * set and onComplete is not called. Otherwise the session completes.
   */
  async resumeAgent(
    sessionId: string,
    userInput: string,
    cwd: string,
    transitions: WorkflowTransition[],
    agentConfig: AgentConfig,
    logFilePath: string,
    onComplete?: (decision: TransitionDecision | null) => void,
  ): Promise<void> {
    const agentSessionId = getAgentSessionId(sessionId);
    if (!agentSessionId) {
      appendToLog(logFilePath, {
        type: "error",
        message: "Cannot resume: no agent session ID available",
      });
      setStatus(sessionId, "FAILED");
      onComplete?.(null);
      return;
    }

    setStatus(sessionId, "RUNNING");

    const abortController = new AbortController();
    this.activeAbortControllers.set(sessionId, abortController);

    const agentRuntime = selectRuntime(agentConfig);
    const sessionTransitions = buildSessionTransitions(transitions);
    const outputFormat =
      agentRuntime.buildTransitionOutputFormat(sessionTransitions);

    let decision: TransitionDecision | null = null;
    try {
      decision = await this.consumeAgentStream(
        agentRuntime.resume({
          sessionId,
          agentSessionId,
          prompt: userInput,
          cwd,
          command: agentConfig.command,
          model: agentConfig.model,
          permissionMode: "acceptEdits",
          abortController,
          outputFormat,
        }),
        sessionId,
        logFilePath,
        agentConfig,
      );
    } catch (err) {
      if (!(err instanceof AbortError)) {
        appendToLog(logFilePath, {
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
      setStatus(sessionId, "FAILED");
      this.activeAbortControllers.delete(sessionId);
      onComplete?.(null);
      return;
    }

    this.activeAbortControllers.delete(sessionId);
    this.handleDecision(sessionId, decision, logFilePath, onComplete);
  }

  /**
   * Consume an agent message stream, logging each message and extracting
   * the transition decision from the result.
   */
  private async consumeAgentStream(
    stream: AsyncIterable<AgentMessage>,
    sessionId: string,
    logFilePath: string,
    agentConfig: AgentConfig,
  ): Promise<TransitionDecision | null> {
    let decision: TransitionDecision | null = null;

    for await (const message of stream) {
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
        decision = processResultMessage(sessionId, message);
        if (message.subtype !== "success") {
          setStatus(sessionId, "FAILED");
        }
      }
    }

    return decision;
  }

  /**
   * Handle the transition decision after an agent stream completes.
   * Sets AWAITING_INPUT or terminal status accordingly.
   */
  private handleDecision(
    sessionId: string,
    decision: TransitionDecision | null,
    logFilePath: string,
    onComplete?: (decision: TransitionDecision | null) => void,
  ): void {
    if (isUserInputTransition(decision)) {
      setStatus(sessionId, "AWAITING_INPUT");
      appendToLog(logFilePath, {
        type: "awaiting_input",
        message: decision!.handoff_summary,
      });
      // Do NOT call onComplete — session is paused, not finished.
      return;
    }

    if (decision) {
      setStatus(sessionId, "SUCCEEDED");
    } else {
      setStatus(sessionId, "FAILED");
    }

    // Ensure the session always reaches a terminal state.
    // The guard in setStatus prevents overwriting SUCCEEDED or FAILED.
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
