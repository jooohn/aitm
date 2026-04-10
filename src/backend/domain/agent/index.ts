import { AbortError } from "@anthropic-ai/claude-agent-sdk";
import { writeFile } from "fs/promises";
import type { SessionStatus } from "@/backend/domain/sessions";
import type { SessionRepository } from "@/backend/domain/sessions/session-repository";
import type {
  AgentConfig,
  AgentProvider,
  OutputMetadataFieldDef,
  WorkflowTransition,
} from "@/backend/infra/config";
import type { EventBus } from "@/backend/infra/event-bus";
import { appendToLog } from "@/backend/utils/log";
import { DEFAULT_PERMISSION_MODE } from "./permission-mode";
import type { AgentMessage, AgentRuntime } from "./runtime";

export interface TransitionDecision {
  transition?: string;
  reason: string;
  handoff_summary: string;
  clarifying_question?: string;
  metadata?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isTerminalSessionStatus(status: SessionStatus | null): boolean {
  return status === "failure" || status === "success";
}

function buildTransitionsSection(transitions: WorkflowTransition[]): string {
  const list = transitions
    .map((t) => {
      const name = "step" in t ? t.step : t.terminal;
      return `  - "${name}": ${t.when}`;
    })
    .join("\n");

  return [
    "<transitions>",
    "When you finish your work, evaluate which transition applies and emit it as your final structured output.",
    "Available transitions (emit the exact transition name in the 'transition' field):",
    list,
    "If you need clarification or input from the user before proceeding, omit the transition field and use clarifying_question to ask.",
    "</transitions>",
  ].join("\n");
}

const CORE_DECISION_KEYS = new Set([
  "transition",
  "reason",
  "handoff_summary",
  "clarifying_question",
]);

export class AgentService {
  private activeAbortControllers = new Map<string, AbortController>();

  constructor(
    private runtimes: Record<AgentProvider, AgentRuntime>,
    private sessionRepository: SessionRepository,
    private eventBus: EventBus,
  ) {}

  private selectRuntime(agentConfig: AgentConfig): AgentRuntime {
    const runtime = this.runtimes[agentConfig.provider];
    if (!runtime) {
      throw new Error(
        `No agent runtime configured for provider: ${agentConfig.provider}`,
      );
    }
    return runtime;
  }

  private finishEarly(sessionId: string): void {
    this.activeAbortControllers.delete(sessionId);
  }

  /** Process messages from an agent stream. Returns the transition decision if one was produced. */
  private processResultMessage(
    sessionId: string,
    message: AgentMessage & { type: "result" },
  ): TransitionDecision | null {
    let decision: TransitionDecision | null = null;
    if (message.subtype === "success" && message.structured_output) {
      const raw = message.structured_output as Record<string, unknown>;
      decision = {
        ...(typeof raw.transition === "string" && raw.transition
          ? { transition: raw.transition }
          : {}),
        reason: raw.reason as string,
        handoff_summary: raw.handoff_summary as string,
        ...(typeof raw.clarifying_question === "string"
          ? { clarifying_question: raw.clarifying_question }
          : {}),
      };

      // Extract metadata: any keys beyond the three core fields
      const metadataEntries = Object.entries(raw).filter(
        ([key]) => !CORE_DECISION_KEYS.has(key),
      );
      if (metadataEntries.length > 0) {
        decision.metadata = Object.fromEntries(
          metadataEntries.map(([k, v]) => [k, String(v)]),
        );
      }

      this.sessionRepository.setTransitionDecision(sessionId, decision);
    }
    return decision;
  }

  /**
   * Start a configured agent runtime for a session. Fire-and-forget — call without
   * awaiting. All errors are handled internally; terminal persistence is delegated
   * to the consumer of the emitted agent-session.completed event.
   *
   * If the agent returns structured output without a transition, the session
   * is set to AWAITING_INPUT and the function returns without calling
   * onComplete. Call resumeAgent() when the user provides input.
   *
   * onComplete is an optional notification hook that mirrors the emitted
   * completion event for callers that need an in-process callback.
   */
  async startAgent(
    sessionId: string,
    cwd: string,
    goal: string,
    transitions: WorkflowTransition[],
    agentConfig: AgentConfig,
    logFilePath: string,
    onComplete?: (decision: TransitionDecision | null) => void,
    metadataFields?: Record<string, OutputMetadataFieldDef>,
  ): Promise<void> {
    const abortController = new AbortController();
    this.activeAbortControllers.set(sessionId, abortController);

    // Yield to the event loop so createSession can return the RUNNING record
    // before any synchronous work here (like worktree lookup) can change status.
    await Promise.resolve();

    if (
      abortController.signal.aborted ||
      isTerminalSessionStatus(
        this.sessionRepository.getSessionStatus(sessionId),
      )
    ) {
      this.finishEarly(sessionId);
      return;
    }

    try {
      await writeFile(logFilePath, "", "utf8");
    } catch {
      // Non-critical — subsequent append attempts are already best-effort.
    }

    const prompt = [goal, "", buildTransitionsSection(transitions)].join("\n");

    let decision: TransitionDecision | null = null;
    try {
      if (
        abortController.signal.aborted ||
        isTerminalSessionStatus(
          this.sessionRepository.getSessionStatus(sessionId),
        )
      ) {
        this.finishEarly(sessionId);
        return;
      }

      const agentRuntime = this.selectRuntime(agentConfig);
      const outputFormat = agentRuntime.buildTransitionOutputFormat(
        transitions,
        metadataFields,
      );

      decision = await this.consumeAgentStream(
        agentRuntime.query({
          sessionId,
          prompt,
          cwd,
          command: agentConfig.command,
          model: agentConfig.model,
          permissionMode:
            agentConfig.permission_mode ?? DEFAULT_PERMISSION_MODE,
          abortController,
          outputFormat,
        }),
        sessionId,
        logFilePath,
        agentConfig,
      );
    } catch (err) {
      if (!(err instanceof AbortError)) {
        await appendToLog(logFilePath, {
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
      this.activeAbortControllers.delete(sessionId);
      if (
        isTerminalSessionStatus(
          this.sessionRepository.getSessionStatus(sessionId),
        )
      ) {
        return;
      }
      this.eventBus.emit("agent-session.completed", {
        sessionId,
        decision: null,
      });
      onComplete?.(null);
      return;
    }

    this.activeAbortControllers.delete(sessionId);
    this.handleDecision(sessionId, decision, logFilePath, onComplete);
  }

  /**
   * Resume a session that is awaiting user input. Fire-and-forget — call
   * without awaiting. Behaves like startAgent for the result handling:
   * if the agent returns structured output without a transition again,
   * AWAITING_INPUT is set and onComplete is not called. Otherwise an agent-session.completed
   * event is emitted and any terminal persistence happens in that subscriber.
   */
  async resumeAgent(
    sessionId: string,
    userInput: string,
    cwd: string,
    transitions: WorkflowTransition[],
    agentConfig: AgentConfig,
    logFilePath: string,
    onComplete?: (decision: TransitionDecision | null) => void,
    metadataFields?: Record<string, OutputMetadataFieldDef>,
  ): Promise<void> {
    const agentSessionId = this.sessionRepository.getAgentSessionId(sessionId);
    if (!agentSessionId) {
      await appendToLog(logFilePath, {
        type: "error",
        message: "Cannot resume: no agent session ID available",
      });
      this.eventBus.emit("agent-session.completed", {
        sessionId,
        decision: null,
      });
      onComplete?.(null);
      return;
    }

    this.sessionRepository.setSessionRunning(
      sessionId,
      new Date().toISOString(),
    );

    const abortController = new AbortController();
    this.activeAbortControllers.set(sessionId, abortController);

    let decision: TransitionDecision | null = null;
    try {
      const agentRuntime = this.selectRuntime(agentConfig);
      const outputFormat = agentRuntime.buildTransitionOutputFormat(
        transitions,
        metadataFields,
      );

      decision = await this.consumeAgentStream(
        agentRuntime.resume({
          sessionId,
          agentSessionId,
          prompt: userInput,
          cwd,
          command: agentConfig.command,
          model: agentConfig.model,
          permissionMode:
            agentConfig.permission_mode ?? DEFAULT_PERMISSION_MODE,
          abortController,
          outputFormat,
        }),
        sessionId,
        logFilePath,
        agentConfig,
      );
    } catch (err) {
      if (!(err instanceof AbortError)) {
        await appendToLog(logFilePath, {
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
      this.activeAbortControllers.delete(sessionId);
      if (
        isTerminalSessionStatus(
          this.sessionRepository.getSessionStatus(sessionId),
        )
      ) {
        return;
      }
      this.eventBus.emit("agent-session.completed", {
        sessionId,
        decision: null,
      });
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
      await appendToLog(logFilePath, message);

      if (message.type === "system" && message.subtype === "init") {
        const attachCommand =
          message.attach_command ??
          (message.session_id
            ? agentConfig.provider === "codex"
              ? `codex resume ${message.session_id}`
              : `claude --resume ${message.session_id}`
            : null);
        this.sessionRepository.setAgentSession(
          sessionId,
          message.session_id ?? null,
          attachCommand,
        );
      }

      if (message.type === "result") {
        decision = this.processResultMessage(sessionId, message);
      }
    }

    return decision;
  }

  /**
   * Handle the transition decision after an agent stream completes.
   * Sets AWAITING_INPUT directly, or emits agent-session.completed for
   * terminal outcomes so higher-level services can persist the final state.
   */
  private async handleDecision(
    sessionId: string,
    decision: TransitionDecision | null,
    logFilePath: string,
    onComplete?: (decision: TransitionDecision | null) => void,
  ): Promise<void> {
    if (decision && !decision.transition) {
      this.sessionRepository.setSessionAwaitingInput(
        sessionId,
        new Date().toISOString(),
      );
      await appendToLog(logFilePath, {
        type: "awaiting_input",
        message: decision.handoff_summary,
      });
      // Do NOT call onComplete — session is paused, not finished.
      return;
    }

    this.eventBus.emit("agent-session.completed", { sessionId, decision });

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
