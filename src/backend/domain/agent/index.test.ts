import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentService } from "@/backend/container";
import { db } from "@/backend/infra/db";

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

const agentConfig = {
  provider: "codex" as const,
  command: "codex",
  model: "test-model",
};

vi.mock("./codex-sdk", () => ({
  codexSDK: {
    query: queryMock,
  },
}));

vi.mock("./claude-cli", () => ({
  claudeCLI: {
    query: vi.fn(),
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
  vi.restoreAllMocks();
  db.prepare("DELETE FROM sessions").run();
});

const startAgent = agentService.startAgent.bind(agentService);

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
