import { AbortError, type CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import type { AskUserQuestionInput } from "@anthropic-ai/claude-agent-sdk/sdk-tools";
import { appendFileSync, writeFileSync } from "fs";
import { type SessionStatus, saveMessage } from "../../domain/sessions";
import { listWorktrees } from "../../domain/worktrees";
import { getAgentConfig, type WorkflowTransition } from "../../infra/config";
import { db } from "../../infra/db";
import { claudeCLI } from "./claude-cli";
import { codexCLI } from "./codex-cli";
import type { AgentRuntime } from "./runtime";

type PendingInput = {
  resolve: (answer: string) => void;
  reject: (err: Error) => void;
};

// Keyed by our session ID — both survive only for the current process lifetime.
const pendingInputs = new Map<string, PendingInput>();
const activeAbortControllers = new Map<string, AbortController>();

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

function createToolPermissionHandler(
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
            q.options.map((o) => `  - ${o.label}: ${o.description}`).join("\n"),
          ].join("\n"),
        )
        .join("\n\n");

      appendToLog(logFilePath, { type: "question", question: questionText });
      saveMessage(sessionId, "agent", questionText);
      setStatus(sessionId, "WAITING_FOR_INPUT");

      try {
        const answer = await waitForInput(sessionId, signal);
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

function waitForInput(sessionId: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new AbortError());
      return;
    }

    const onAbort = () => {
      pendingInputs.delete(sessionId);
      reject(new AbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });

    pendingInputs.set(sessionId, {
      resolve: (answer) => {
        signal.removeEventListener("abort", onAbort);
        resolve(answer);
      },
      reject,
    });
  });
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

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

export function buildTransitionOutputFormat(transitions: WorkflowTransition[]) {
  const transitionNames = transitions.map((t) =>
    "state" in t ? t.state : t.terminal,
  );

  return {
    type: "json_schema" as const,
    schema: {
      type: "object",
      properties: {
        transition: {
          type: "string",
          enum: transitionNames,
        },
        reason: { type: "string" },
        handoff_summary: { type: "string" },
      },
      required: ["transition", "reason", "handoff_summary"],
      additionalProperties: false,
    },
  };
}

/**
 * Start a configured agent runtime for a session. Fire-and-forget — call without
 * awaiting. All errors are handled internally; the session is marked FAILED
 * if anything goes wrong. Calls onComplete with the structured transition
 * decision when the session ends (null if the session failed or produced no output).
 */
export async function startAgent(
  sessionId: string,
  repoPath: string,
  worktreeBranch: string,
  goal: string,
  transitions: WorkflowTransition[],
  logFilePath: string,
  onComplete?: (decision: TransitionDecision | null) => void,
): Promise<void> {
  // Yield to the event loop so createSession can return the RUNNING record
  // before any synchronous work here (like worktree lookup) can change status.
  await Promise.resolve();

  writeFileSync(logFilePath, "", "utf8");

  let worktreePath: string;
  try {
    const worktrees = listWorktrees(repoPath);
    const worktree = worktrees.find((w) => w.branch === worktreeBranch);
    if (!worktree) throw new Error(`Worktree not found: ${worktreeBranch}`);
    worktreePath = worktree.path;
  } catch (err) {
    appendToLog(logFilePath, {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
    setStatus(sessionId, "FAILED");
    onComplete?.(null);
    return;
  }

  const abortController = new AbortController();
  activeAbortControllers.set(sessionId, abortController);
  const agentConfig = getAgentConfig();
  const agentRuntime: AgentRuntime =
    agentConfig.provider === "codex" ? codexCLI : claudeCLI;

  const prompt = [
    goal,
    "",
    buildTransitionsSection(transitions),
    "",
    "Use the AskUserQuestion tool if you need clarification from the user.",
  ].join("\n");

  const canUseTool = createToolPermissionHandler(sessionId, logFilePath);

  let decision: TransitionDecision | null = null;
  try {
    for await (const message of agentRuntime.query({
      sessionId,
      prompt,
      cwd: worktreePath,
      command: agentConfig.command,
      model: agentConfig.model,
      permissionMode: "acceptEdits",
      abortController,
      canUseTool,
      outputFormat: buildTransitionOutputFormat(transitions),
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
    activeAbortControllers.delete(sessionId);
    pendingInputs.delete(sessionId);
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
export function sendMessageToAgent(sessionId: string, answer: string): void {
  const pending = pendingInputs.get(sessionId);
  if (pending) {
    pendingInputs.delete(sessionId);
    pending.resolve(answer);
  }
}

/**
 * Abort a running agent. Rejects any pending input promise and signals the
 * AbortController so the for-await loop exits.
 */
export function cancelAgent(sessionId: string): void {
  const pending = pendingInputs.get(sessionId);
  if (pending) {
    pendingInputs.delete(sessionId);
    pending.reject(new AbortError());
  }
  const controller = activeAbortControllers.get(sessionId);
  if (controller) {
    activeAbortControllers.delete(sessionId);
    controller.abort();
  }
}

export interface TransitionDecision {
  transition: string;
  reason: string;
  handoff_summary: string;
}
