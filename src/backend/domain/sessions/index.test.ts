import { mkdirSync, writeFileSync } from "fs";
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
const getSession = sessionService.getSession.bind(sessionService);
const listMessages = sessionService.listMessages.bind(sessionService);
const listSessions = sessionService.listSessions.bind(sessionService);
const saveMessage = sessionService.saveMessage.bind(sessionService);

vi.spyOn(agentService, "startAgent").mockResolvedValue();
vi.spyOn(agentService, "cancelAgent").mockImplementation(() => {});
vi.spyOn(agentService, "sendMessageToAgent").mockImplementation(() => {});
vi.spyOn(worktreeService, "listWorktrees").mockImplementation((repoPath) => [
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
]);

const DEFAULT_TRANSITIONS = [{ terminal: "success" as const, when: "Done" }];

function makeFakeGitRepo(): string {
  const dir = join(
    tmpdir(),
    `aitm-test-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

beforeEach(() => {
  db.prepare("DELETE FROM session_messages").run();
  db.prepare("DELETE FROM sessions").run();
  vi.clearAllMocks();
});

describe("createSession", () => {
  it("creates a session with RUNNING status", () => {
    const repoPath = makeFakeGitRepo();
    const session = createSession({
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

  it("passes an explicit agent config to startAgent", () => {
    const repoPath = makeFakeGitRepo();
    const agentConfig = {
      provider: "codex" as const,
      model: "gpt-5.4",
      command: "/opt/homebrew/bin/codex",
    };

    const session = createSession({
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
      undefined,
    );
  });

  it("uses the top-level agent config when no override is provided", async () => {
    const dir = join(
      tmpdir(),
      `aitm-config-test-${Math.random().toString(36).slice(2)}`,
    );
    const configPath = join(dir, "config.yaml");
    mkdirSync(dir, { recursive: true });
    process.env.AITM_CONFIG_PATH = configPath;

    const repoPath = makeFakeGitRepo();
    try {
      writeFileSync(
        configPath,
        `
agent:
  provider: codex
  model: gpt-5.4
  command: /opt/homebrew/bin/codex
workflows: {}
`,
      );

      const session = createSession({
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
        undefined,
      );
    } finally {
      delete process.env.AITM_CONFIG_PATH;
    }
  });
});

describe("listSessions", () => {
  it("returns all sessions ordered by created_at descending", () => {
    const repoPath = makeFakeGitRepo();
    createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "Goal A",
      transitions: DEFAULT_TRANSITIONS,
    });
    createSession({
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

  it("filters by repository_path", () => {
    const path1 = makeFakeGitRepo();
    const path2 = makeFakeGitRepo();
    createSession({
      repository_path: path1,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
    });
    createSession({
      repository_path: path2,
      worktree_branch: "feat/b",
      goal: "B",
      transitions: DEFAULT_TRANSITIONS,
    });

    const sessions = listSessions({ repository_path: path1 });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].worktree_branch).toBe("feat/a");
  });

  it("filters by worktree_branch", () => {
    const repoPath = makeFakeGitRepo();
    createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
    });
    createSession({
      repository_path: repoPath,
      worktree_branch: "feat/b",
      goal: "B",
      transitions: DEFAULT_TRANSITIONS,
    });

    const sessions = listSessions({ worktree_branch: "feat/a" });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].goal).toBe("A");
  });

  it("filters by status", () => {
    const repoPath = makeFakeGitRepo();
    const session = createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
    });
    failSession(session.id);
    createSession({
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
  it("returns the session by id", () => {
    const repoPath = makeFakeGitRepo();
    const created = createSession({
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

describe("listMessages", () => {
  it("returns messages ordered by created_at ascending", () => {
    const repoPath = makeFakeGitRepo();
    const session = createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
    });
    saveMessage(session.id, "agent", "What branch?");
    saveMessage(session.id, "user", "feature/x");

    const messages = listMessages(session.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("agent");
    expect(messages[0].content).toBe("What branch?");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toBe("feature/x");
  });

  it("returns empty array for session with no messages", () => {
    const repoPath = makeFakeGitRepo();
    const session = createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
    });
    expect(listMessages(session.id)).toEqual([]);
  });

  it("only returns messages for the specified session", () => {
    const repoPath = makeFakeGitRepo();
    const s1 = createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
    });
    const s2 = createSession({
      repository_path: repoPath,
      worktree_branch: "feat/b",
      goal: "B",
      transitions: DEFAULT_TRANSITIONS,
    });
    saveMessage(s1.id, "agent", "Message for s1");

    expect(listMessages(s2.id)).toHaveLength(0);
    expect(listMessages(s1.id)).toHaveLength(1);
  });
});

describe("failSession", () => {
  it("marks a RUNNING session as FAILED", () => {
    const repoPath = makeFakeGitRepo();
    const session = createSession({
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

  it("throws when session is already in a terminal state", () => {
    const repoPath = makeFakeGitRepo();
    const session = createSession({
      repository_path: repoPath,
      worktree_branch: "feat/a",
      goal: "A",
      transitions: DEFAULT_TRANSITIONS,
    });
    failSession(session.id);

    expect(() => failSession(session.id)).toThrow("terminal state");
  });
});
