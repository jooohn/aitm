import {
  AbortError,
  type CanUseTool,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import type { AskUserQuestionInput } from "@anthropic-ai/claude-agent-sdk/sdk-tools";
import { appendFileSync, writeFileSync } from "fs";
import { db } from "./db";
import { type SessionStatus, saveMessage } from "./sessions";
import { listWorktrees } from "./worktrees";

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

function setClaudeSession(sessionId: string, claudeSessionId: string): void {
  db.prepare(
    `UPDATE sessions
     SET claude_session_id = ?, terminal_attach_command = ?
     WHERE id = ?`,
  ).run(claudeSessionId, `claude --resume ${claudeSessionId}`, sessionId);
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
    return { behavior: "allow" };
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

/**
 * Start a Claude Code agent for a session. Fire-and-forget — call without
 * awaiting. All errors are handled internally; the session is marked FAILED
 * if anything goes wrong.
 */
export async function startAgent(
  sessionId: string,
  repoPath: string,
  worktreeBranch: string,
  goal: string,
  completionCondition: string,
  logFilePath: string,
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
    return;
  }

  const abortController = new AbortController();
  activeAbortControllers.set(sessionId, abortController);

  const prompt = [
    `Goal: ${goal}`,
    "",
    `Work autonomously to accomplish the goal above. When you believe the following completion condition is met, stop:`,
    `${completionCondition}`,
    "",
    `Use the AskUserQuestion tool if you need clarification from the user.`,
  ].join("\n");

  const canUseTool = createToolPermissionHandler(sessionId, logFilePath);

  try {
    for await (const message of query({
      prompt,
      options: {
        cwd: worktreePath,
        permissionMode: "acceptEdits",
        abortController,
        canUseTool,
      },
    })) {
      appendToLog(logFilePath, message);

      if (message.type === "system" && message.subtype === "init") {
        setClaudeSession(sessionId, message.session_id);
      }

      if (message.type === "result") {
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

const TRANSITION_OUTPUT_FORMAT = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    properties: {
      transition: { type: "string" },
      reason: { type: "string" },
      handoff_summary: { type: "string" },
    },
    required: ["transition", "reason", "handoff_summary"],
    additionalProperties: false,
  },
};

/**
 * Start a Claude Code agent for a workflow state execution. Fire-and-forget.
 * Uses outputFormat to constrain Claude's final output to a transition decision.
 * Calls onComplete when done (with structured decision or null on failure).
 */
export async function startWorkflowStateAgent(
  sessionId: string,
  repoPath: string,
  worktreeBranch: string,
  prompt: string,
  logFilePath: string,
  onComplete: (decision: TransitionDecision | null) => void,
): Promise<void> {
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
    onComplete(null);
    return;
  }

  const abortController = new AbortController();
  activeAbortControllers.set(sessionId, abortController);

  const canUseTool = createToolPermissionHandler(sessionId, logFilePath);

  let decision: TransitionDecision | null = null;
  try {
    for await (const message of query({
      prompt,
      options: {
        cwd: worktreePath,
        permissionMode: "acceptEdits",
        abortController,
        canUseTool,
        outputFormat: TRANSITION_OUTPUT_FORMAT,
      },
    })) {
      appendToLog(logFilePath, message);

      if (message.type === "system" && message.subtype === "init") {
        setClaudeSession(sessionId, message.session_id);
      }

      if (message.type === "result") {
        if (message.subtype === "success" && message.structured_output) {
          decision = message.structured_output as TransitionDecision;
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

  onComplete(decision);
}
