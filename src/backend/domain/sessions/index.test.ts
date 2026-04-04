import { mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentService,
  sessionService,
  worktreeService,
} from "@/backend/container";
import { db } from "@/backend/infra/db";

const createSession = sessionService.createSession.bind(sessionService);
const failSession = sessionService.failSession.bind(sessionService);
const replyToSession = sessionService.replyToSession.bind(sessionService);
const getSession = sessionService.getSession.bind(sessionService);
const listSessions = sessionService.listSessions.bind(sessionService);

vi.spyOn(agentService, "startAgent").mockResolvedValue();
vi.spyOn(agentService, "resumeAgent").mockResolvedValue();
vi.spyOn(agentService, "cancelAgent").mockImplementation(() => {});
vi.spyOn(worktreeService, "listWorktrees").mockImplementation(
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

const DEFAULT_TRANSITIONS = [{ terminal: "success" as const, when: "Done" }];

async function makeFakeGitRepo(): Promise<string> {
  const dir = join(
    tmpdir(),
    `aitm-test-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(join(dir, ".git"), { recursive: true });
  return dir;
}

beforeEach(() => {
  db.prepare("DELETE FROM sessions").run();
  vi.clearAllMocks();
});

describe("createSession", () => {
  it("creates a session with RUNNING status", async () => {
    const repoPath = await makeFakeGitRepo();
    const session = await createSession({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      goal: "Write an implementation plan",
      transitions: DEFAULT_TRANSITIONS,
    });

    expect(session.id).toBeTypeOf("string");
    expect(session.status).toBe("RUNNING");
    expect(session.repository_path).toBe(repoPath);
    expect(session.worktree_branch).toBe("feat/test");
    expect(session.goal).toBe("Write an implementation plan");
    expect(JSON.parse(session.transitions)).toEqual(DEFAULT_TRANSITIONS);
    expect(session.transition_decision).toBeNull();
    expect(session.log_file_path).toContain(session.id);
    expect(session.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("passes an explicit agent config to startAgent", async () => {
    const repoPath = await makeFakeGitRepo();
    const agentConfig = {
      provider: "codex" as const,
      model: "gpt-5.4",
      command: "/opt/homebrew/bin/codex",
    };

    const session = await createSession({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      goal: "Write code",
      transitions: DEFAULT_TRANSITIONS,
      agent_config: agentConfig,
    });

    expect(agentService.startAgent).toHaveBeenCalledWith(
      session.id,
      repoPath,
      "Write code",
      DEFAULT_TRANSITIONS,
      agentConfig,
      session.log_file_path,
      expect.any(Function),
      undefined,
    );
  });

  it("uses the top-level agent config when no override is provided", async () => {
    const dir = join(
      tmpdir(),
      `aitm-config-test-${Math.random().toString(36).slice(2)}`,
    );
    const configPath = join(dir, "config.yaml");
    await mkdir(dir, { recursive: true });
    process.env.AITM_CONFIG_PATH = configPath;

    const repoPath = await makeFakeGitRepo();
    try {
      await writeFile(
        configPath,
        `
agent:
  provider: codex
  model: gpt-5.4
  command: /opt/homebrew/bin/codex
workflows: {}
`,
      );

      const session = await createSession({
        repository_path: repoPath,
        worktree_branch: "feat/test",
        goal: "Write code",
        transitions: DEFAULT_TRANSITIONS,
      });

      expect(agentService.startAgent).toHaveBeenCalledWith(
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
        expect.any(Function),
        undefined,
      );
    } finally {
      delete process.env.AITM_CONFIG_PATH;
    }
  });
});

describe("listSessions", () => {
  it("returns all sessions ordered by created_at descending", async () => {
    const repoPath = await makeFakeGitRepo();
    await createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "Goal A",
      transitions: DEFAULT_TRANSITIONS,
    });
    await createSession({
      repository_path: repoPath,
      worktree_branch: "feat/b",
      goal: "Goal B",
      transitions: DEFAULT_TRANSITIONS,
    });

    const sessions = listSessions();
    expect(sessions).toHaveLength(2);
    const branches = sessions.map((s) => s.worktree_branch);
    expect(branches).toContain("feat/a");
    expect(branches).toContain("feat/b");
  });

  it("filters by repository_path", async () => {
    const path1 = await makeFakeGitRepo();
    const path2 = await makeFakeGitRepo();
    await createSession({
      repository_path: path1,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
    });
    await createSession({
      repository_path: path2,
      worktree_branch: "feat/b",
      goal: "B",
      transitions: DEFAULT_TRANSITIONS,
    });

    const sessions = listSessions({ repository_path: path1 });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].worktree_branch).toBe("feat/a");
  });

  it("filters by worktree_branch", async () => {
    const repoPath = await makeFakeGitRepo();
    await createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
    });
    await createSession({
      repository_path: repoPath,
      worktree_branch: "feat/b",
      goal: "B",
      transitions: DEFAULT_TRANSITIONS,
    });

    const sessions = listSessions({ worktree_branch: "feat/a" });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].goal).toBe("A");
  });

  it("filters by status", async () => {
    const repoPath = await makeFakeGitRepo();
    const session = await createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
    });
    failSession(session.id);
    await createSession({
      repository_path: repoPath,
      worktree_branch: "feat/b",
      goal: "B",
      transitions: DEFAULT_TRANSITIONS,
    });

    expect(listSessions({ status: "RUNNING" })).toHaveLength(1);
    expect(listSessions({ status: "FAILED" })).toHaveLength(1);
  });
});

describe("getSession", () => {
  it("returns the session by id", async () => {
    const repoPath = await makeFakeGitRepo();
    const created = await createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
    });

    const found = getSession(created.id);
    expect(found).toBeDefined();
    expect(found?.id).toBe(created.id);
  });

  it("returns undefined for unknown id", () => {
    expect(getSession("nonexistent")).toBeUndefined();
  });
});

describe("failSession", () => {
  it("marks a RUNNING session as FAILED", async () => {
    const repoPath = await makeFakeGitRepo();
    const session = await createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
    });

    const failed = failSession(session.id);
    expect(failed.status).toBe("FAILED");
  });

  it("throws when session is not found", () => {
    expect(() => failSession("nonexistent")).toThrow("Session not found");
  });

  it("throws when session is already in a terminal state", async () => {
    const repoPath = await makeFakeGitRepo();
    const session = await createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
    });
    failSession(session.id);

    expect(() => failSession(session.id)).toThrow("terminal state");
  });

  it("marks an AWAITING_INPUT session as FAILED", async () => {
    const repoPath = await makeFakeGitRepo();
    const session = await createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
    });
    // Manually set status to AWAITING_INPUT
    db.prepare(
      "UPDATE sessions SET status = 'AWAITING_INPUT' WHERE id = ?",
    ).run(session.id);

    const failed = failSession(session.id);
    expect(failed.status).toBe("FAILED");
  });
});

describe("replyToSession", () => {
  it("calls resumeAgent when session is AWAITING_INPUT", async () => {
    const repoPath = await makeFakeGitRepo();
    const session = await createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
    });
    db.prepare(
      "UPDATE sessions SET status = 'AWAITING_INPUT' WHERE id = ?",
    ).run(session.id);

    await replyToSession(session.id, "Use PostgreSQL");

    expect(agentService.resumeAgent).toHaveBeenCalledWith(
      session.id,
      "Use PostgreSQL",
      repoPath,
      DEFAULT_TRANSITIONS,
      expect.any(Object),
      session.log_file_path,
      expect.any(Function),
      undefined,
    );
  });

  it("throws when session is not found", async () => {
    await expect(replyToSession("nonexistent", "hello")).rejects.toThrow(
      "Session not found",
    );
  });

  it("throws when session is RUNNING", async () => {
    const repoPath = await makeFakeGitRepo();
    const session = await createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
    });

    await expect(replyToSession(session.id, "hello")).rejects.toThrow(
      "not awaiting input",
    );
  });

  it("throws when session is in a terminal state", async () => {
    const repoPath = await makeFakeGitRepo();
    const session = await createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
    });
    failSession(session.id);

    await expect(replyToSession(session.id, "hello")).rejects.toThrow(
      "not awaiting input",
    );
  });

  it("uses the agent config from session creation, not the current default", async () => {
    const repoPath = await makeFakeGitRepo();
    const agentConfig = {
      provider: "codex" as const,
      model: "gpt-5.4",
      command: "/opt/homebrew/bin/codex",
    };

    const session = await createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
      agent_config: agentConfig,
    });
    db.prepare(
      "UPDATE sessions SET status = 'AWAITING_INPUT' WHERE id = ?",
    ).run(session.id);

    await replyToSession(session.id, "Continue");

    expect(agentService.resumeAgent).toHaveBeenCalledWith(
      session.id,
      "Continue",
      repoPath,
      DEFAULT_TRANSITIONS,
      agentConfig,
      session.log_file_path,
      expect.any(Function),
      undefined,
    );
  });
});
