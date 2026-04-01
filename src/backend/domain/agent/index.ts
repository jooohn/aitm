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

export class AgentService {
  private activeAbortControllers = new Map<string, AbortController>();
  private pendingInputs = new Map<string, (input: string) => void>();

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

      // Run the initial query
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

      // Loop while the agent requests user input
      while (
        decision?.transition === USER_INPUT_TRANSITION_NAME &&
        !abortController.signal.aborted
      ) {
        setStatus(sessionId, "AWAITING_INPUT");
        appendToLog(logFilePath, {
          type: "awaiting_input",
          message: decision.handoff_summary,
        });

        const userInput = await new Promise<string>((resolve, reject) => {
          this.pendingInputs.set(sessionId, resolve);
          // If abort fires while waiting, reject so we exit the loop.
          const onAbort = () => {
            this.pendingInputs.delete(sessionId);
            reject(new AbortError());
          };
          abortController.signal.addEventListener("abort", onAbort, {
            once: true,
          });
        });
        this.pendingInputs.delete(sessionId);

        setStatus(sessionId, "RUNNING");

        const agentSessionId = getAgentSessionId(sessionId);
        if (!agentSessionId) {
          appendToLog(logFilePath, {
            type: "error",
            message: "Cannot resume: no agent session ID available",
          });
          break;
        }

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
      }

      // Set terminal status based on the final decision
      if (decision && decision.transition !== USER_INPUT_TRANSITION_NAME) {
        setStatus(sessionId, "SUCCEEDED");
      } else {
        setStatus(sessionId, "FAILED");
      }
    } catch (err) {
      if (!(err instanceof AbortError)) {
        appendToLog(logFilePath, {
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
      setStatus(sessionId, "FAILED");
    } finally {
      this.activeAbortControllers.delete(sessionId);
      this.pendingInputs.delete(sessionId);
    }

    // Ensure the session always reaches a terminal state.
    // The guard in setStatus prevents overwriting SUCCEEDED or FAILED.
    setStatus(sessionId, "FAILED");

    onComplete?.(
      decision?.transition === USER_INPUT_TRANSITION_NAME ? null : decision,
    );
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
   * Provide user input to a session that is awaiting input.
   * Resolves the pending Promise so startAgent can resume the agent.
   */
  provideInput(sessionId: string, input: string): void {
    const resolve = this.pendingInputs.get(sessionId);
    if (resolve) {
      resolve(input);
    }
  }

  /**
   * Abort a running agent. Signals the AbortController so the for-await loop exits.
   * Also cleans up any pending input Promise.
   */
  cancelAgent(sessionId: string): void {
    this.pendingInputs.delete(sessionId);
    const controller = this.activeAbortControllers.get(sessionId);
    if (controller) {
      this.activeAbortControllers.delete(sessionId);
      controller.abort();
    }
  }
}
