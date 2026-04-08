import { mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionRepository } from "@/backend/domain/sessions/session-repository";
import { WorkflowRunRepository } from "@/backend/domain/workflow-runs/workflow-run-repository";
import { db } from "@/backend/infra/db";
import { eventBus } from "@/backend/infra/event-bus";
import { AgentService, type TransitionDecision } from ".";
import type { AgentMessage, AgentRuntime, OutputFormat } from "./runtime";

const { queryMock, resumeMock, buildOutputFormatMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  resumeMock: vi.fn(),
  buildOutputFormatMock: vi.fn(),
}));

const agentConfig = {
  provider: "codex" as const,
  command: "codex",
  model: "test-model",
};

let agentSessionCompletedListener:
  | ((payload: {
      sessionId: string;
      decision: TransitionDecision | null;
    }) => void)
  | null = null;

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
        claude_session_id, step_execution_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, NULL, ?, ?)`,
  ).run(
    sessionId,
    repoPath,
    "feat/test",
    "Goal",
    JSON.stringify([{ terminal: "success", when: "done" }]),
    opts?.status ?? "running",
    logFilePath,
    opts?.claude_session_id ?? null,
    now,
    now,
  );
}

beforeEach(() => {
  if (agentSessionCompletedListener) {
    eventBus.off("agent-session.completed", agentSessionCompletedListener);
    agentSessionCompletedListener = null;
  }
  new WorkflowRunRepository(db).ensureTables();
  new SessionRepository(db, eventBus).ensureTables();
  queryMock.mockReset();
  resumeMock.mockReset();
  buildOutputFormatMock.mockReset();
  vi.restoreAllMocks();
  db.prepare("DELETE FROM sessions").run();
});

function buildRuntime(): AgentRuntime {
  return {
    query: queryMock,
    resume: resumeMock,
    buildTransitionOutputFormat: (...args): OutputFormat => {
      buildOutputFormatMock(...args);
      return { type: "json_schema", schema: {} };
    },
  };
}

function buildAgentService(): AgentService {
  const sessionRepository = new SessionRepository(db, eventBus);
  agentSessionCompletedListener = ({ sessionId, decision }) => {
    const now = new Date().toISOString();
    if (decision) {
      sessionRepository.setSessionSucceeded(sessionId, now, decision);
      return;
    }

    sessionRepository.setSessionFailed(sessionId, now);
  };
  eventBus.on("agent-session.completed", agentSessionCompletedListener);

  return new AgentService(
    {
      codex: buildRuntime(),
      claude: buildRuntime(),
    },
    sessionRepository,
    eventBus,
  );
}

describe("startAgent", () => {
  it("extracts metadata fields from structured output and includes them in the decision", async () => {
    const agentService = buildAgentService();
    const repoPath = await makeFakeGitRepo();
    const sessionId = "session-with-metadata";
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
          handoff_summary: "Created PR",
          pr_url: "https://github.com/org/repo/pull/42",
          pr_number: "42",
        },
      };
    });

    await agentService.startAgent(
      sessionId,
      repoPath,
      "Goal",
      [{ terminal: "success", when: "done" }],
      agentConfig,
      logFilePath,
      onComplete,
    );

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        transition: "success",
        metadata: {
          pr_url: "https://github.com/org/repo/pull/42",
          pr_number: "42",
        },
      }),
    );
  });

  it("omits metadata field when structured output has no extra keys", async () => {
    const agentService = buildAgentService();
    const repoPath = await makeFakeGitRepo();
    const sessionId = "session-no-metadata";
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

    await agentService.startAgent(
      sessionId,
      repoPath,
      "Goal",
      [{ terminal: "success", when: "done" }],
      agentConfig,
      logFilePath,
      onComplete,
    );

    const decision = onComplete.mock.calls[0][0];
    expect(decision.metadata).toBeUndefined();
  });

  it("sets awaiting_input and returns when agent selects __REQUIRE_USER_INPUT__", async () => {
    const agentService = buildAgentService();
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
          clarifying_question: "What database should I use?",
        },
      };
    });

    await agentService.startAgent(
      sessionId,
      repoPath,
      "Goal",
      [{ terminal: "success", when: "done" }],
      agentConfig,
      logFilePath,
      onComplete,
    );

    // Session should be awaiting_input
    const row = db
      .prepare("SELECT status, transition_decision FROM sessions WHERE id = ?")
      .get(sessionId) as { status: string; transition_decision: string };
    expect(row.status).toBe("awaiting_input");
    expect(JSON.parse(row.transition_decision)).toEqual({
      transition: "__REQUIRE_USER_INPUT__",
      reason: "Need clarification",
      handoff_summary: "What database should I use?",
      clarifying_question: "What database should I use?",
    });

    // onComplete should NOT have been called
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("treats clarifying_question as a core decision field instead of metadata", async () => {
    const agentService = buildAgentService();
    const repoPath = await makeFakeGitRepo();
    const sessionId = "session-core-clarifying-question";
    const logFilePath = join(tmpdir(), `${sessionId}.log`);
    const onComplete = vi.fn();
    insertSession(sessionId, repoPath, logFilePath);

    queryMock.mockImplementation(async function* () {
      yield { type: "system", subtype: "init", session_id: "agent-1" };
      yield {
        type: "result",
        subtype: "success",
        structured_output: {
          transition: "__REQUIRE_USER_INPUT__",
          reason: "Need clarification",
          handoff_summary: "Need user input",
          clarifying_question: "Which environment should I target?",
          pr_url: "https://github.com/org/repo/pull/42",
        },
      };
    });

    await agentService.startAgent(
      sessionId,
      repoPath,
      "Goal",
      [{ terminal: "success", when: "done" }],
      agentConfig,
      logFilePath,
      onComplete,
    );

    expect(onComplete).not.toHaveBeenCalled();
    expect(
      db
        .prepare("SELECT transition_decision FROM sessions WHERE id = ?")
        .get(sessionId),
    ).toEqual({
      transition_decision: JSON.stringify({
        transition: "__REQUIRE_USER_INPUT__",
        reason: "Need clarification",
        handoff_summary: "Need user input",
        clarifying_question: "Which environment should I target?",
        metadata: {
          pr_url: "https://github.com/org/repo/pull/42",
        },
      }),
    });
  });

  it("emits session.status-changed event when agent sets awaiting_input", async () => {
    const agentService = buildAgentService();
    const repoPath = await makeFakeGitRepo();
    const sessionId = "session-status-changed-event";
    const logFilePath = join(tmpdir(), `${sessionId}.log`);
    insertSession(sessionId, repoPath, logFilePath);

    const statusChangedListener = vi.fn();
    eventBus.on("session.status-changed", statusChangedListener);

    queryMock.mockImplementation(async function* () {
      yield {
        type: "system",
        subtype: "init",
        session_id: "agent-session-ev",
      };
      yield {
        type: "result",
        subtype: "success",
        structured_output: {
          transition: "__REQUIRE_USER_INPUT__",
          reason: "Need clarification",
          handoff_summary: "What database?",
        },
      };
    });

    await agentService.startAgent(
      sessionId,
      repoPath,
      "Goal",
      [{ terminal: "success", when: "done" }],
      agentConfig,
      logFilePath,
    );

    expect(statusChangedListener).toHaveBeenCalledWith({
      sessionId,
      status: "awaiting_input",
    });

    eventBus.off("session.status-changed", statusChangedListener);
  });

  it("sets success when agent completes with a real transition", async () => {
    const agentService = buildAgentService();
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

    await agentService.startAgent(
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
    expect(row.status).toBe("success");
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ transition: "success" }),
    );
  });

  it("passes metadataFields to buildTransitionOutputFormat when provided", async () => {
    const agentService = buildAgentService();
    const repoPath = await makeFakeGitRepo();
    const sessionId = "session-metadata-fields";
    const logFilePath = join(tmpdir(), `${sessionId}.log`);
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

    const metadataFields = {
      pr_url: { type: "string", description: "The pull request URL" },
    };

    await agentService.startAgent(
      sessionId,
      repoPath,
      "Goal",
      [{ terminal: "success" as const, when: "done" }],
      agentConfig,
      logFilePath,
      undefined,
      metadataFields,
    );

    expect(buildOutputFormatMock).toHaveBeenCalledWith(
      expect.any(Array),
      metadataFields,
    );
  });

  it("calls buildTransitionOutputFormat without metadataFields when not provided", async () => {
    const agentService = buildAgentService();
    const repoPath = await makeFakeGitRepo();
    const sessionId = "session-no-metadata-fields";
    const logFilePath = join(tmpdir(), `${sessionId}.log`);
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

    await agentService.startAgent(
      sessionId,
      repoPath,
      "Goal",
      [{ terminal: "success" as const, when: "done" }],
      agentConfig,
      logFilePath,
    );

    expect(buildOutputFormatMock).toHaveBeenCalledWith(
      expect.any(Array),
      undefined,
    );
  });

  it("does not launch the runtime when the session is already terminal before startup continues", async () => {
    const agentService = buildAgentService();
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

    const startPromise = agentService.startAgent(
      sessionId,
      repoPath,
      "Goal",
      [{ terminal: "success", when: "done" }],
      agentConfig,
      logFilePath,
      onComplete,
    );

    db.prepare("UPDATE sessions SET status = 'failure' WHERE id = ?").run(
      sessionId,
    );

    await startPromise;

    expect(queryMock).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(
      db.prepare("SELECT status FROM sessions WHERE id = ?").get(sessionId),
    ).toEqual({ status: "failure" });
  });

  it("completes the session when it becomes terminal after cwd is set but before runtime launch", async () => {
    const agentService = buildAgentService();
    const repoPath = await makeFakeGitRepo();
    const sessionId = "session-stopped-before-runtime";
    const logFilePath = join(tmpdir(), `${sessionId}.log`);
    const onComplete = vi.fn();
    insertSession(sessionId, repoPath, logFilePath);

    // Mark session as failure before startAgent's second terminal check
    db.prepare("UPDATE sessions SET status = 'failure' WHERE id = ?").run(
      sessionId,
    );

    await agentService.startAgent(
      sessionId,
      repoPath,
      "Goal",
      [{ terminal: "success", when: "done" }],
      agentConfig,
      logFilePath,
      onComplete,
    );

    expect(queryMock).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(
      db.prepare("SELECT status FROM sessions WHERE id = ?").get(sessionId),
    ).toEqual({ status: "failure" });
  });

  it("uses the injected claude runtime when the provider is claude", async () => {
    const claudeQueryMock = vi.fn(async function* (): AsyncGenerator<
      AgentMessage,
      void,
      unknown
    > {
      yield { type: "system", subtype: "init", session_id: "claude-agent-1" };
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
    const claudeRuntime: AgentRuntime = {
      query: claudeQueryMock,
      resume: vi.fn(),
      buildTransitionOutputFormat: () => ({ type: "json_schema", schema: {} }),
    };
    const sessionRepository = new SessionRepository(db, eventBus);
    const agentService = new AgentService(
      {
        codex: buildRuntime(),
        claude: claudeRuntime,
      },
      sessionRepository,
      eventBus,
    );
    const repoPath = await makeFakeGitRepo();
    const sessionId = "session-claude-runtime";
    const logFilePath = join(tmpdir(), `${sessionId}.log`);
    insertSession(sessionId, repoPath, logFilePath);

    await agentService.startAgent(
      sessionId,
      repoPath,
      "Goal",
      [{ terminal: "success", when: "done" }],
      { ...agentConfig, provider: "claude" },
      logFilePath,
    );

    expect(claudeQueryMock).toHaveBeenCalledOnce();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("marks the session failed when the provider does not map to an injected runtime", async () => {
    const agentService = buildAgentService();
    const repoPath = await makeFakeGitRepo();
    const sessionId = "session-invalid-provider";
    const logFilePath = join(tmpdir(), `${sessionId}.log`);
    const onComplete = vi.fn();
    insertSession(sessionId, repoPath, logFilePath);

    await agentService.startAgent(
      sessionId,
      repoPath,
      "Goal",
      [{ terminal: "success", when: "done" }],
      { ...agentConfig, provider: "invalid" as never },
      logFilePath,
      onComplete,
    );

    const row = db
      .prepare("SELECT status FROM sessions WHERE id = ?")
      .get(sessionId) as { status: string };
    expect(row.status).toBe("failure");
    expect(onComplete).toHaveBeenCalledWith(null);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe("resumeAgent", () => {
  it("resumes agent and sets success when agent completes with a real transition", async () => {
    const agentService = buildAgentService();
    const repoPath = await makeFakeGitRepo();
    const sessionId = "session-resume-success";
    const logFilePath = join(tmpdir(), `${sessionId}.log`);
    const onComplete = vi.fn();
    insertSession(sessionId, repoPath, logFilePath, {
      status: "awaiting_input",
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

    await agentService.resumeAgent(
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
    expect(row.status).toBe("success");
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

  it("sets awaiting_input again when agent requests more input", async () => {
    const agentService = buildAgentService();
    const repoPath = await makeFakeGitRepo();
    const sessionId = "session-resume-more-input";
    const logFilePath = join(tmpdir(), `${sessionId}.log`);
    const onComplete = vi.fn();
    insertSession(sessionId, repoPath, logFilePath, {
      status: "awaiting_input",
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

    await agentService.resumeAgent(
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
    expect(row.status).toBe("awaiting_input");
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("emits session.status-changed with running when resuming", async () => {
    const agentService = buildAgentService();
    const repoPath = await makeFakeGitRepo();
    const sessionId = "session-resume-running-event";
    const logFilePath = join(tmpdir(), `${sessionId}.log`);
    insertSession(sessionId, repoPath, logFilePath, {
      status: "awaiting_input",
      claude_session_id: "agent-session-running",
    });

    const statusChangedListener = vi.fn();
    eventBus.on("session.status-changed", statusChangedListener);

    resumeMock.mockImplementation(async function* () {
      yield {
        type: "result",
        subtype: "success",
        structured_output: {
          transition: "__REQUIRE_USER_INPUT__",
          reason: "Need more detail",
          handoff_summary: "Still need clarification",
        },
      };
    });

    await agentService.resumeAgent(
      sessionId,
      "Continue",
      repoPath,
      [{ terminal: "success", when: "done" }],
      agentConfig,
      logFilePath,
    );

    expect(statusChangedListener).toHaveBeenNthCalledWith(1, {
      sessionId,
      status: "running",
    });

    eventBus.off("session.status-changed", statusChangedListener);
  });

  it("passes metadataFields to buildTransitionOutputFormat on resume", async () => {
    const agentService = buildAgentService();
    const repoPath = await makeFakeGitRepo();
    const sessionId = "session-resume-metadata";
    const logFilePath = join(tmpdir(), `${sessionId}.log`);
    insertSession(sessionId, repoPath, logFilePath, {
      status: "awaiting_input",
      claude_session_id: "agent-session-meta",
    });

    resumeMock.mockImplementation(async function* () {
      yield {
        type: "result",
        subtype: "success",
        structured_output: {
          transition: "success",
          reason: "done",
          handoff_summary: "Done",
        },
      };
    });

    const metadataFields = {
      pr_url: { type: "string", description: "The pull request URL" },
    };

    await agentService.resumeAgent(
      sessionId,
      "User input",
      repoPath,
      [{ terminal: "success" as const, when: "done" }],
      agentConfig,
      logFilePath,
      undefined,
      metadataFields,
    );

    expect(buildOutputFormatMock).toHaveBeenCalledWith(
      expect.any(Array),
      metadataFields,
    );
  });

  it("sets failure when resume produces an error result", async () => {
    const agentService = buildAgentService();
    const repoPath = await makeFakeGitRepo();
    const sessionId = "session-resume-error";
    const logFilePath = join(tmpdir(), `${sessionId}.log`);
    const onComplete = vi.fn();
    insertSession(sessionId, repoPath, logFilePath, {
      status: "awaiting_input",
      claude_session_id: "agent-session-789",
    });

    resumeMock.mockImplementation(async function* () {
      yield {
        type: "result",
        subtype: "error",
        result: "Something went wrong",
      };
    });

    await agentService.resumeAgent(
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
    expect(row.status).toBe("failure");
    expect(onComplete).toHaveBeenCalledWith(null);
  });

  it("marks the session failed when resume uses an unknown provider", async () => {
    const agentService = buildAgentService();
    const repoPath = await makeFakeGitRepo();
    const sessionId = "session-resume-invalid-provider";
    const logFilePath = join(tmpdir(), `${sessionId}.log`);
    const onComplete = vi.fn();
    insertSession(sessionId, repoPath, logFilePath, {
      status: "awaiting_input",
      claude_session_id: "agent-session-invalid-provider",
    });

    await agentService.resumeAgent(
      sessionId,
      "PostgreSQL",
      repoPath,
      [{ terminal: "success", when: "done" }],
      { ...agentConfig, provider: "invalid" as never },
      logFilePath,
      onComplete,
    );

    const row = db
      .prepare("SELECT status FROM sessions WHERE id = ?")
      .get(sessionId) as { status: string };
    expect(row.status).toBe("failure");
    expect(onComplete).toHaveBeenCalledWith(null);
    expect(resumeMock).not.toHaveBeenCalled();
  });
});
