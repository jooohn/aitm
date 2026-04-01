import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentService } from "@/backend/container";
import { db } from "@/backend/infra/db";

const { queryMock, resumeMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  resumeMock: vi.fn(),
}));

const agentConfig = {
  provider: "codex" as const,
  command: "codex",
  model: "test-model",
};

vi.mock("./codex-sdk", () => ({
  codexSDK: {
    query: queryMock,
    resume: resumeMock,
    buildTransitionOutputFormat: (transitions: unknown[]) => ({
      type: "json_schema",
      schema: {},
    }),
  },
}));

vi.mock("./claude-cli", () => ({
  claudeCLI: {
    query: vi.fn(),
    resume: vi.fn(),
    buildTransitionOutputFormat: () => ({ type: "json_schema", schema: {} }),
  },
}));

function makeFakeGitRepo(): string {
  const dir = join(
    tmpdir(),
    `aitm-agent-test-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

beforeEach(() => {
  queryMock.mockReset();
  resumeMock.mockReset();
  vi.restoreAllMocks();
  db.prepare("DELETE FROM sessions").run();
});

const startAgent = agentService.startAgent.bind(agentService);
const provideInput = agentService.provideInput.bind(agentService);
const cancelAgent = agentService.cancelAgent.bind(agentService);

describe("startAgent", () => {
  it("does not launch the runtime when the session is already terminal before startup continues", async () => {
    const repoPath = makeFakeGitRepo();
    const sessionId = "session-stopped-before-start";
    const now = new Date().toISOString();
    const logFilePath = join(tmpdir(), `${sessionId}.log`);
    const onComplete = vi.fn();

    db.prepare(
      `INSERT INTO sessions
         (id, repository_path, worktree_branch, goal, transitions,
          transition_decision, status, terminal_attach_command, log_file_path,
          claude_session_id, state_execution_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, 'RUNNING', NULL, ?, NULL, NULL, ?, ?)`,
    ).run(
      sessionId,
      repoPath,
      "feat/test",
      "Goal",
      JSON.stringify([{ terminal: "success", when: "done" }]),
      logFilePath,
      now,
      now,
    );

    queryMock.mockImplementation(async function* () {
      yield {
        type: "result",
        subtype: "success",
        structured_output: {
          transition: "success",
          reason: "done",
          handoff_summary: "done",
        },
      };
    });

    const startPromise = startAgent(
      sessionId,
      repoPath,
      "Goal",
      [{ terminal: "success", when: "done" }],
      agentConfig,
      logFilePath,
      onComplete,
    );

    db.prepare("UPDATE sessions SET status = 'FAILED' WHERE id = ?").run(
      sessionId,
    );

    await startPromise;

    expect(queryMock).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith(null);
    expect(
      db.prepare("SELECT status FROM sessions WHERE id = ?").get(sessionId),
    ).toEqual({ status: "FAILED" });
  });

  it("pauses session as AWAITING_INPUT when agent selects __REQUIRE_USER_INPUT__ and resumes on provideInput", async () => {
    const repoPath = makeFakeGitRepo();
    const sessionId = "session-user-input";
    const now = new Date().toISOString();
    const logFilePath = join(tmpdir(), `${sessionId}.log`);
    const onComplete = vi.fn();

    db.prepare(
      `INSERT INTO sessions
         (id, repository_path, worktree_branch, goal, transitions,
          transition_decision, status, terminal_attach_command, log_file_path,
          claude_session_id, state_execution_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, 'RUNNING', NULL, ?, NULL, NULL, ?, ?)`,
    ).run(
      sessionId,
      repoPath,
      "feat/test",
      "Goal",
      JSON.stringify([{ terminal: "success", when: "done" }]),
      logFilePath,
      now,
      now,
    );

    // First call: agent requests user input
    queryMock.mockImplementation(async function* () {
      yield {
        type: "system",
        subtype: "init",
        session_id: "agent-session-123",
      };
      yield {
        type: "result",
        subtype: "success",
        structured_output: {
          transition: "__REQUIRE_USER_INPUT__",
          reason: "Need clarification",
          handoff_summary: "What database should I use?",
        },
      };
    });

    // Second call (resume): agent completes normally
    resumeMock.mockImplementation(async function* () {
      yield {
        type: "result",
        subtype: "success",
        structured_output: {
          transition: "success",
          reason: "done",
          handoff_summary: "Used PostgreSQL as instructed",
        },
      };
    });

    const startPromise = startAgent(
      sessionId,
      repoPath,
      "Goal",
      [{ terminal: "success", when: "done" }],
      agentConfig,
      logFilePath,
      onComplete,
    );

    // Wait for the session to reach AWAITING_INPUT
    await vi.waitFor(() => {
      const row = db
        .prepare("SELECT status FROM sessions WHERE id = ?")
        .get(sessionId) as { status: string };
      expect(row.status).toBe("AWAITING_INPUT");
    });

    // onComplete should NOT have been called yet
    expect(onComplete).not.toHaveBeenCalled();

    // Provide user input to resume the session
    provideInput(sessionId, "Use PostgreSQL");

    await startPromise;

    // Session should now be SUCCEEDED
    const row = db
      .prepare("SELECT status, transition_decision FROM sessions WHERE id = ?")
      .get(sessionId) as { status: string; transition_decision: string };
    expect(row.status).toBe("SUCCEEDED");
    const decision = JSON.parse(row.transition_decision);
    expect(decision.transition).toBe("success");

    // onComplete called with real transition decision
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ transition: "success" }),
    );

    // resume was called with user input
    expect(resumeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSessionId: "agent-session-123",
        prompt: "Use PostgreSQL",
      }),
    );
  });

  it("supports multiple rounds of user input", async () => {
    const repoPath = makeFakeGitRepo();
    const sessionId = "session-multi-input";
    const now = new Date().toISOString();
    const logFilePath = join(tmpdir(), `${sessionId}.log`);
    const onComplete = vi.fn();

    db.prepare(
      `INSERT INTO sessions
         (id, repository_path, worktree_branch, goal, transitions,
          transition_decision, status, terminal_attach_command, log_file_path,
          claude_session_id, state_execution_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, 'RUNNING', NULL, ?, NULL, NULL, ?, ?)`,
    ).run(
      sessionId,
      repoPath,
      "feat/test",
      "Goal",
      JSON.stringify([{ terminal: "success", when: "done" }]),
      logFilePath,
      now,
      now,
    );

    // Initial query: request user input
    queryMock.mockImplementation(async function* () {
      yield {
        type: "system",
        subtype: "init",
        session_id: "agent-session-456",
      };
      yield {
        type: "result",
        subtype: "success",
        structured_output: {
          transition: "__REQUIRE_USER_INPUT__",
          reason: "Need DB choice",
          handoff_summary: "Which DB?",
        },
      };
    });

    let resumeCallCount = 0;
    resumeMock.mockImplementation(async function* () {
      resumeCallCount++;
      if (resumeCallCount === 1) {
        // Second round: request more input
        yield {
          type: "result",
          subtype: "success",
          structured_output: {
            transition: "__REQUIRE_USER_INPUT__",
            reason: "Need port",
            handoff_summary: "Which port?",
          },
        };
      } else {
        // Third round: complete
        yield {
          type: "result",
          subtype: "success",
          structured_output: {
            transition: "success",
            reason: "done",
            handoff_summary: "All done",
          },
        };
      }
    });

    const startPromise = startAgent(
      sessionId,
      repoPath,
      "Goal",
      [{ terminal: "success", when: "done" }],
      agentConfig,
      logFilePath,
      onComplete,
    );

    // First AWAITING_INPUT
    await vi.waitFor(() => {
      const row = db
        .prepare("SELECT status FROM sessions WHERE id = ?")
        .get(sessionId) as { status: string };
      expect(row.status).toBe("AWAITING_INPUT");
    });
    provideInput(sessionId, "PostgreSQL");

    // Second AWAITING_INPUT
    await vi.waitFor(() => {
      // Must wait for status to cycle back to AWAITING_INPUT after being RUNNING
      const row = db
        .prepare("SELECT status FROM sessions WHERE id = ?")
        .get(sessionId) as { status: string };
      // resumeCallCount === 1 means the first resume happened
      expect(resumeCallCount).toBeGreaterThanOrEqual(1);
      expect(row.status).toBe("AWAITING_INPUT");
    });
    provideInput(sessionId, "5432");

    await startPromise;

    const row = db
      .prepare("SELECT status FROM sessions WHERE id = ?")
      .get(sessionId) as { status: string };
    expect(row.status).toBe("SUCCEEDED");
    expect(resumeMock).toHaveBeenCalledTimes(2);
  });

  it("cancelAgent cleans up pending input and fails the session", async () => {
    const repoPath = makeFakeGitRepo();
    const sessionId = "session-cancel-input";
    const now = new Date().toISOString();
    const logFilePath = join(tmpdir(), `${sessionId}.log`);
    const onComplete = vi.fn();

    db.prepare(
      `INSERT INTO sessions
         (id, repository_path, worktree_branch, goal, transitions,
          transition_decision, status, terminal_attach_command, log_file_path,
          claude_session_id, state_execution_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, 'RUNNING', NULL, ?, NULL, NULL, ?, ?)`,
    ).run(
      sessionId,
      repoPath,
      "feat/test",
      "Goal",
      JSON.stringify([{ terminal: "success", when: "done" }]),
      logFilePath,
      now,
      now,
    );

    queryMock.mockImplementation(async function* () {
      yield {
        type: "system",
        subtype: "init",
        session_id: "agent-session-789",
      };
      yield {
        type: "result",
        subtype: "success",
        structured_output: {
          transition: "__REQUIRE_USER_INPUT__",
          reason: "Need info",
          handoff_summary: "Question?",
        },
      };
    });

    const startPromise = startAgent(
      sessionId,
      repoPath,
      "Goal",
      [{ terminal: "success", when: "done" }],
      agentConfig,
      logFilePath,
      onComplete,
    );

    // Wait for AWAITING_INPUT
    await vi.waitFor(() => {
      const row = db
        .prepare("SELECT status FROM sessions WHERE id = ?")
        .get(sessionId) as { status: string };
      expect(row.status).toBe("AWAITING_INPUT");
    });

    // Cancel the agent
    cancelAgent(sessionId);

    await startPromise;

    // The session should reach FAILED (set by the finally block / fallback)
    const row = db
      .prepare("SELECT status FROM sessions WHERE id = ?")
      .get(sessionId) as { status: string };
    expect(row.status).toBe("FAILED");
  });

  it("completes the session when it becomes terminal after cwd is set but before runtime launch", async () => {
    const repoPath = makeFakeGitRepo();
    const sessionId = "session-stopped-before-runtime";
    const now = new Date().toISOString();
    const logFilePath = join(tmpdir(), `${sessionId}.log`);
    const onComplete = vi.fn();

    db.prepare(
      `INSERT INTO sessions
         (id, repository_path, worktree_branch, goal, transitions,
          transition_decision, status, terminal_attach_command, log_file_path,
          claude_session_id, state_execution_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, 'RUNNING', NULL, ?, NULL, NULL, ?, ?)`,
    ).run(
      sessionId,
      repoPath,
      "feat/test",
      "Goal",
      JSON.stringify([{ terminal: "success", when: "done" }]),
      logFilePath,
      now,
      now,
    );

    // Mark session as FAILED before startAgent's second terminal check
    db.prepare("UPDATE sessions SET status = 'FAILED' WHERE id = ?").run(
      sessionId,
    );

    await startAgent(
      sessionId,
      repoPath,
      "Goal",
      [{ terminal: "success", when: "done" }],
      agentConfig,
      logFilePath,
      onComplete,
    );

    expect(queryMock).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith(null);
    expect(
      db.prepare("SELECT status FROM sessions WHERE id = ?").get(sessionId),
    ).toEqual({ status: "FAILED" });
  });
});
