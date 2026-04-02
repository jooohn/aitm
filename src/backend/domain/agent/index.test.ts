import { mkdir } from "fs/promises";
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

async function makeFakeGitRepo(): Promise<string> {
  const dir = join(
    tmpdir(),
    `aitm-agent-test-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(join(dir, ".git"), { recursive: true });
  return dir;
}

function insertSession(
  sessionId: string,
  repoPath: string,
  logFilePath: string,
  opts?: { status?: string; claude_session_id?: string },
) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions
       (id, repository_path, worktree_branch, goal, transitions,
        transition_decision, status, terminal_attach_command, log_file_path,
        claude_session_id, state_execution_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, NULL, ?, ?)`,
  ).run(
    sessionId,
    repoPath,
    "feat/test",
    "Goal",
    JSON.stringify([{ terminal: "success", when: "done" }]),
    opts?.status ?? "RUNNING",
    logFilePath,
    opts?.claude_session_id ?? null,
    now,
    now,
  );
}

beforeEach(() => {
  queryMock.mockReset();
  resumeMock.mockReset();
  vi.restoreAllMocks();
  db.prepare("DELETE FROM sessions").run();
});

const startAgent = agentService.startAgent.bind(agentService);
const resumeAgent = agentService.resumeAgent.bind(agentService);

describe("startAgent", () => {
  it("sets AWAITING_INPUT and returns when agent selects __REQUIRE_USER_INPUT__", async () => {
    const repoPath = await makeFakeGitRepo();
    const sessionId = "session-user-input";
    const logFilePath = join(tmpdir(), `${sessionId}.log`);
    const onComplete = vi.fn();
    insertSession(sessionId, repoPath, logFilePath);

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

    await startAgent(
      sessionId,
      repoPath,
      "Goal",
      [{ terminal: "success", when: "done" }],
      agentConfig,
      logFilePath,
      onComplete,
    );

    // Session should be AWAITING_INPUT
    const row = db
      .prepare("SELECT status FROM sessions WHERE id = ?")
      .get(sessionId) as { status: string };
    expect(row.status).toBe("AWAITING_INPUT");

    // onComplete should NOT have been called
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("sets SUCCEEDED when agent completes with a real transition", async () => {
    const repoPath = await makeFakeGitRepo();
    const sessionId = "session-success";
    const logFilePath = join(tmpdir(), `${sessionId}.log`);
    const onComplete = vi.fn();
    insertSession(sessionId, repoPath, logFilePath);

    queryMock.mockImplementation(async function* () {
      yield { type: "system", subtype: "init", session_id: "agent-1" };
      yield {
        type: "result",
        subtype: "success",
        structured_output: {
          transition: "success",
          reason: "done",
          handoff_summary: "All done",
        },
      };
    });

    await startAgent(
      sessionId,
      repoPath,
      "Goal",
      [{ terminal: "success", when: "done" }],
      agentConfig,
      logFilePath,
      onComplete,
    );

    const row = db
      .prepare("SELECT status FROM sessions WHERE id = ?")
      .get(sessionId) as { status: string };
    expect(row.status).toBe("SUCCEEDED");
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ transition: "success" }),
    );
  });

  it("does not launch the runtime when the session is already terminal before startup continues", async () => {
    const repoPath = await makeFakeGitRepo();
    const sessionId = "session-stopped-before-start";
    const logFilePath = join(tmpdir(), `${sessionId}.log`);
    const onComplete = vi.fn();
    insertSession(sessionId, repoPath, logFilePath);

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

  it("completes the session when it becomes terminal after cwd is set but before runtime launch", async () => {
    const repoPath = await makeFakeGitRepo();
    const sessionId = "session-stopped-before-runtime";
    const logFilePath = join(tmpdir(), `${sessionId}.log`);
    const onComplete = vi.fn();
    insertSession(sessionId, repoPath, logFilePath);

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

describe("resumeAgent", () => {
  it("resumes agent and sets SUCCEEDED when agent completes with a real transition", async () => {
    const repoPath = await makeFakeGitRepo();
    const sessionId = "session-resume-success";
    const logFilePath = join(tmpdir(), `${sessionId}.log`);
    const onComplete = vi.fn();
    insertSession(sessionId, repoPath, logFilePath, {
      status: "AWAITING_INPUT",
      claude_session_id: "agent-session-123",
    });

    resumeMock.mockImplementation(async function* () {
      yield {
        type: "result",
        subtype: "success",
        structured_output: {
          transition: "success",
          reason: "done",
          handoff_summary: "Used PostgreSQL",
        },
      };
    });

    await resumeAgent(
      sessionId,
      "Use PostgreSQL",
      repoPath,
      [{ terminal: "success", when: "done" }],
      agentConfig,
      logFilePath,
      onComplete,
    );

    const row = db
      .prepare("SELECT status, transition_decision FROM sessions WHERE id = ?")
      .get(sessionId) as { status: string; transition_decision: string };
    expect(row.status).toBe("SUCCEEDED");
    expect(JSON.parse(row.transition_decision).transition).toBe("success");

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ transition: "success" }),
    );

    expect(resumeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSessionId: "agent-session-123",
        prompt: "Use PostgreSQL",
      }),
    );
  });

  it("sets AWAITING_INPUT again when agent requests more input", async () => {
    const repoPath = await makeFakeGitRepo();
    const sessionId = "session-resume-more-input";
    const logFilePath = join(tmpdir(), `${sessionId}.log`);
    const onComplete = vi.fn();
    insertSession(sessionId, repoPath, logFilePath, {
      status: "AWAITING_INPUT",
      claude_session_id: "agent-session-456",
    });

    resumeMock.mockImplementation(async function* () {
      yield {
        type: "result",
        subtype: "success",
        structured_output: {
          transition: "__REQUIRE_USER_INPUT__",
          reason: "Need port",
          handoff_summary: "Which port?",
        },
      };
    });

    await resumeAgent(
      sessionId,
      "PostgreSQL",
      repoPath,
      [{ terminal: "success", when: "done" }],
      agentConfig,
      logFilePath,
      onComplete,
    );

    const row = db
      .prepare("SELECT status FROM sessions WHERE id = ?")
      .get(sessionId) as { status: string };
    expect(row.status).toBe("AWAITING_INPUT");
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("sets FAILED when resume produces an error result", async () => {
    const repoPath = await makeFakeGitRepo();
    const sessionId = "session-resume-error";
    const logFilePath = join(tmpdir(), `${sessionId}.log`);
    const onComplete = vi.fn();
    insertSession(sessionId, repoPath, logFilePath, {
      status: "AWAITING_INPUT",
      claude_session_id: "agent-session-789",
    });

    resumeMock.mockImplementation(async function* () {
      yield {
        type: "result",
        subtype: "error",
        result: "Something went wrong",
      };
    });

    await resumeAgent(
      sessionId,
      "PostgreSQL",
      repoPath,
      [{ terminal: "success", when: "done" }],
      agentConfig,
      logFilePath,
      onComplete,
    );

    const row = db
      .prepare("SELECT status FROM sessions WHERE id = ?")
      .get(sessionId) as { status: string };
    expect(row.status).toBe("FAILED");
    expect(onComplete).toHaveBeenCalledWith(null);
  });
});
