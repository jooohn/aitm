import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as container from "@/backend/container";
import { db } from "@/backend/infra/db";
import { eventBus } from "@/backend/infra/event-bus";
import { setupTestConfigDir, writeTestConfig } from "@/test-config-helper";

const DEFAULT_TRANSITIONS = [{ terminal: "success" as const, when: "Done" }];
let configFile: string;
let logCounter = 0;

function tempLogFilePath(): string {
  return join(
    tmpdir(),
    "aitm-test-logs",
    `${++logCounter}-${randomUUID()}.log`,
  );
}

async function makeFakeGitRepo(): Promise<string> {
  const dir = join(
    tmpdir(),
    `aitm-test-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(join(dir, ".git"), { recursive: true });
  return dir;
}

beforeEach(async () => {
  configFile = await setupTestConfigDir();
  await writeTestConfig(configFile, "workflows: {}\n");
  container.initializeContainer();
  db.prepare("DELETE FROM sessions").run();
  vi.spyOn(container.agentService, "startAgent").mockResolvedValue();
  vi.spyOn(container.agentService, "resumeAgent").mockResolvedValue();
  vi.spyOn(container.agentService, "cancelAgent").mockImplementation(() => {});
  vi.spyOn(container.worktreeService, "listWorktrees").mockImplementation(
    async (repoPath) => [
      {
        branch: "feat/test",
        path: repoPath,
        is_main: false,
        is_bare: false,
        head: "HEAD",
      },
      {
        branch: "feat/a",
        path: repoPath,
        is_main: false,
        is_bare: false,
        head: "HEAD",
      },
      {
        branch: "feat/b",
        path: repoPath,
        is_main: false,
        is_bare: false,
        head: "HEAD",
      },
    ],
  );
});

describe("createSession", () => {
  it("creates a session with running status", async () => {
    const repoPath = await makeFakeGitRepo();
    const logPath = tempLogFilePath();
    const session = await container.sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      goal: "Write an implementation plan",
      transitions: DEFAULT_TRANSITIONS,
      log_file_path: logPath,
    });

    expect(session.id).toBeTypeOf("string");
    expect(session.status).toBe("running");
    expect(session.repository_path).toBe(repoPath);
    expect(session.worktree_branch).toBe("feat/test");
    expect(session.goal).toBe("Write an implementation plan");
    expect(session.transitions).toEqual(DEFAULT_TRANSITIONS);
    expect(session.transition_decision).toBeNull();
    expect(session.log_file_path).toBe(logPath);
    expect(session.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns parsed metadata fields and agent config from the repository boundary", async () => {
    const repoPath = await makeFakeGitRepo();
    const session = await container.sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      goal: "Collect metadata",
      transitions: DEFAULT_TRANSITIONS,
      log_file_path: tempLogFilePath(),
      agent_config: {
        provider: "codex",
        model: "gpt-5.4",
        command: "codex",
      },
      metadata_fields: {
        pr_url: {
          type: "string",
          description: "Pull request URL",
        },
      },
    });

    expect(session.agent_config).toEqual({
      provider: "codex",
      model: "gpt-5.4",
      command: "codex",
    });
    expect(session.metadata_fields).toEqual({
      pr_url: {
        type: "string",
        description: "Pull request URL",
      },
    });
  });

  it("passes an explicit agent config to startAgent", async () => {
    const repoPath = await makeFakeGitRepo();
    const agentConfig = {
      provider: "codex" as const,
      model: "gpt-5.4",
      command: "/opt/homebrew/bin/codex",
    };

    const session = await container.sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      goal: "Write code",
      transitions: DEFAULT_TRANSITIONS,
      log_file_path: tempLogFilePath(),
      agent_config: agentConfig,
    });

    expect(container.agentService.startAgent).toHaveBeenCalledWith(
      session.id,
      repoPath,
      "Write code",
      DEFAULT_TRANSITIONS,
      agentConfig,
      session.log_file_path,
      undefined,
      undefined,
    );
  });

  it("uses the top-level agent config when no override is provided", async () => {
    const repoPath = await makeFakeGitRepo();
    await writeTestConfig(
      configFile,
      `
agent:
  provider: codex
  model: gpt-5.4
  command: /opt/homebrew/bin/codex
workflows: {}
`,
    );
    container.initializeContainer();
    vi.spyOn(container.agentService, "startAgent").mockResolvedValue();
    vi.spyOn(container.worktreeService, "listWorktrees").mockImplementation(
      async (repoPath) => [
        {
          branch: "feat/test",
          path: repoPath,
          is_main: false,
          is_bare: false,
          head: "HEAD",
        },
      ],
    );

    const session = await container.sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      goal: "Write code",
      transitions: DEFAULT_TRANSITIONS,
      log_file_path: tempLogFilePath(),
    });

    expect(container.agentService.startAgent).toHaveBeenCalledWith(
      session.id,
      repoPath,
      "Write code",
      DEFAULT_TRANSITIONS,
      {
        provider: "codex",
        model: "gpt-5.4",
        command: "/opt/homebrew/bin/codex",
      },
      session.log_file_path,
      undefined,
      undefined,
    );
  });
});

describe("listSessions", () => {
  it("returns all sessions ordered by created_at descending", async () => {
    const repoPath = await makeFakeGitRepo();
    await container.sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "Goal A",
      transitions: DEFAULT_TRANSITIONS,
      log_file_path: tempLogFilePath(),
    });
    await container.sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/b",
      goal: "Goal B",
      transitions: DEFAULT_TRANSITIONS,
      log_file_path: tempLogFilePath(),
    });

    const sessions = container.sessionService.listSessions();
    expect(sessions).toHaveLength(2);
    const branches = sessions.map((s) => s.worktree_branch);
    expect(branches).toContain("feat/a");
    expect(branches).toContain("feat/b");
  });

  it("filters by repository_path", async () => {
    const path1 = await makeFakeGitRepo();
    const path2 = await makeFakeGitRepo();
    await container.sessionService.createSession({
      repository_path: path1,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
      log_file_path: tempLogFilePath(),
    });
    await container.sessionService.createSession({
      repository_path: path2,
      worktree_branch: "feat/b",
      goal: "B",
      transitions: DEFAULT_TRANSITIONS,
      log_file_path: tempLogFilePath(),
    });

    const sessions = container.sessionService.listSessions({
      repository_path: path1,
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].worktree_branch).toBe("feat/a");
  });

  it("filters by worktree_branch", async () => {
    const repoPath = await makeFakeGitRepo();
    await container.sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
      log_file_path: tempLogFilePath(),
    });
    await container.sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/b",
      goal: "B",
      transitions: DEFAULT_TRANSITIONS,
      log_file_path: tempLogFilePath(),
    });

    const sessions = container.sessionService.listSessions({
      worktree_branch: "feat/a",
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].goal).toBe("A");
  });

  it("filters by status", async () => {
    const repoPath = await makeFakeGitRepo();
    const session = await container.sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
      log_file_path: tempLogFilePath(),
    });
    container.sessionService.failSession(session.id);
    await container.sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/b",
      goal: "B",
      transitions: DEFAULT_TRANSITIONS,
      log_file_path: tempLogFilePath(),
    });

    expect(
      container.sessionService.listSessions({ status: "running" }),
    ).toHaveLength(1);
    expect(
      container.sessionService.listSessions({ status: "failure" }),
    ).toHaveLength(1);
  });
});

describe("getSession", () => {
  it("returns the session by id", async () => {
    const repoPath = await makeFakeGitRepo();
    const created = await container.sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
      log_file_path: tempLogFilePath(),
    });

    const found = container.sessionService.getSession(created.id);
    expect(found).toBeDefined();
    expect(found?.id).toBe(created.id);
  });

  it("returns undefined for unknown id", () => {
    expect(container.sessionService.getSession("nonexistent")).toBeUndefined();
  });
});

describe("failSession", () => {
  it("marks a running session as failure", async () => {
    const repoPath = await makeFakeGitRepo();
    const session = await container.sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
      log_file_path: tempLogFilePath(),
    });

    const failed = container.sessionService.failSession(session.id);
    expect(failed.status).toBe("failure");
  });

  it("emits session.status-changed when a session is failed", async () => {
    const repoPath = await makeFakeGitRepo();
    const session = await container.sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
      log_file_path: tempLogFilePath(),
    });
    const listener = vi.fn();

    eventBus.on("session.status-changed", listener);
    container.sessionService.failSession(session.id);

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.id,
        status: "failure",
        decision: null,
      }),
    );
    eventBus.off("session.status-changed", listener);
  });

  it("throws when session is not found", () => {
    expect(() => container.sessionService.failSession("nonexistent")).toThrow(
      "Session not found",
    );
  });

  it("throws when session is already in a terminal state", async () => {
    const repoPath = await makeFakeGitRepo();
    const session = await container.sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
      log_file_path: tempLogFilePath(),
    });
    container.sessionService.failSession(session.id);

    expect(() => container.sessionService.failSession(session.id)).toThrow(
      "terminal state",
    );
  });

  it("marks an awaiting_input session as failure", async () => {
    const repoPath = await makeFakeGitRepo();
    const session = await container.sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
      log_file_path: tempLogFilePath(),
    });
    // Manually set status to awaiting_input
    db.prepare(
      "UPDATE sessions SET status = 'awaiting_input' WHERE id = ?",
    ).run(session.id);

    const failed = container.sessionService.failSession(session.id);
    expect(failed.status).toBe("failure");
  });
});

describe("replyToSession", () => {
  it("calls resumeAgent when session is awaiting_input", async () => {
    const repoPath = await makeFakeGitRepo();
    const session = await container.sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
      log_file_path: tempLogFilePath(),
    });
    db.prepare(
      "UPDATE sessions SET status = 'awaiting_input' WHERE id = ?",
    ).run(session.id);

    await container.sessionService.replyToSession(session.id, "Use PostgreSQL");

    expect(container.agentService.resumeAgent).toHaveBeenCalledWith(
      session.id,
      "Use PostgreSQL",
      repoPath,
      DEFAULT_TRANSITIONS,
      expect.any(Object),
      session.log_file_path,
      undefined,
      undefined,
    );
  });

  it("appends the accepted user reply to the session log before resuming", async () => {
    const repoPath = await makeFakeGitRepo();
    const session = await container.sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
      log_file_path: tempLogFilePath(),
    });
    db.prepare(
      "UPDATE sessions SET status = 'awaiting_input' WHERE id = ?",
    ).run(session.id);

    await container.sessionService.replyToSession(session.id, "Use PostgreSQL");

    await expect(readFile(session.log_file_path, "utf8")).resolves.toContain(
      `${JSON.stringify({ type: "user_input", message: "Use PostgreSQL" })}\n`,
    );
  });

  it("throws when session is not found", async () => {
    await expect(
      container.sessionService.replyToSession("nonexistent", "hello"),
    ).rejects.toThrow("Session not found");
  });

  it("throws when session is RUNNING", async () => {
    const repoPath = await makeFakeGitRepo();
    const session = await container.sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
      log_file_path: tempLogFilePath(),
    });

    await expect(
      container.sessionService.replyToSession(session.id, "hello"),
    ).rejects.toThrow("not awaiting input");
  });

  it("throws when session is in a terminal state", async () => {
    const repoPath = await makeFakeGitRepo();
    const session = await container.sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
      log_file_path: tempLogFilePath(),
    });
    container.sessionService.failSession(session.id);

    await expect(
      container.sessionService.replyToSession(session.id, "hello"),
    ).rejects.toThrow("not awaiting input");
  });

  it("uses the agent config from session creation, not the current default", async () => {
    const repoPath = await makeFakeGitRepo();
    const agentConfig = {
      provider: "codex" as const,
      model: "gpt-5.4",
      command: "/opt/homebrew/bin/codex",
    };

    const session = await container.sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
      log_file_path: tempLogFilePath(),
      agent_config: agentConfig,
    });
    db.prepare(
      "UPDATE sessions SET status = 'awaiting_input' WHERE id = ?",
    ).run(session.id);

    await container.sessionService.replyToSession(session.id, "Continue");

    expect(container.agentService.resumeAgent).toHaveBeenCalledWith(
      session.id,
      "Continue",
      repoPath,
      DEFAULT_TRANSITIONS,
      agentConfig,
      session.log_file_path,
      undefined,
      undefined,
    );
  });
});

describe("agent-session.completed subscription", () => {
  it("marks the session as success and emits terminal session.status-changed", async () => {
    const repoPath = await makeFakeGitRepo();
    const session = await container.sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
      log_file_path: tempLogFilePath(),
    });
    const statusListener = vi.fn();

    eventBus.on("session.status-changed", statusListener);
    eventBus.emit("agent-session.completed", {
      sessionId: session.id,
      decision: {
        transition: "implement",
        reason: "done",
        handoff_summary: "finished",
      },
    });

    expect(container.sessionService.getSession(session.id)?.status).toBe(
      "success",
    );
    expect(statusListener).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.id,
        status: "success",
        decision: {
          transition: "implement",
          reason: "done",
          handoff_summary: "finished",
        },
      }),
    );
    eventBus.off("session.status-changed", statusListener);
  });

  it("emits terminal session.status-changed only once for a terminal agent completion", async () => {
    const repoPath = await makeFakeGitRepo();
    const session = await container.sessionService.createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
      log_file_path: tempLogFilePath(),
    });
    const statusListener = vi.fn();
    const decision = {
      transition: "implement",
      reason: "done",
      handoff_summary: "finished",
    };

    eventBus.on("session.status-changed", statusListener);

    const onComplete = vi
      .mocked(container.agentService.startAgent)
      .mock.calls.at(-1)?.[6];
    expect(onComplete).toBeUndefined();

    eventBus.emit("agent-session.completed", {
      sessionId: session.id,
      decision,
    });

    expect(statusListener).toHaveBeenCalledTimes(1);
    expect(statusListener).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.id,
        status: "success",
        decision,
      }),
    );

    eventBus.off("session.status-changed", statusListener);
  });
});
