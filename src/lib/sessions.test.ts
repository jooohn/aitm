import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { registerRepository } from "./repositories";
import {
  createSession,
  failSession,
  getSession,
  listSessions,
} from "./sessions";

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
  db.prepare("DELETE FROM repositories").run();
});

describe("createSession", () => {
  it("creates a session with RUNNING status", () => {
    const repo = registerRepository({ path: makeFakeGitRepo() });
    const session = createSession({
      repository_id: repo.id,
      worktree_branch: "feat/test",
      goal: "Write an implementation plan",
      completion_condition: "Plan document exists",
    });

    expect(session.id).toBeTypeOf("string");
    expect(session.status).toBe("RUNNING");
    expect(session.repository_id).toBe(repo.id);
    expect(session.worktree_branch).toBe("feat/test");
    expect(session.goal).toBe("Write an implementation plan");
    expect(session.completion_condition).toBe("Plan document exists");
    expect(session.log_file_path).toContain(session.id);
    expect(session.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("listSessions", () => {
  it("returns all sessions ordered by created_at descending", () => {
    const repo = registerRepository({ path: makeFakeGitRepo() });
    createSession({
      repository_id: repo.id,
      worktree_branch: "feat/a",
      goal: "Goal A",
      completion_condition: "Done A",
    });
    createSession({
      repository_id: repo.id,
      worktree_branch: "feat/b",
      goal: "Goal B",
      completion_condition: "Done B",
    });

    const sessions = listSessions();
    expect(sessions).toHaveLength(2);
    const branches = sessions.map((s) => s.worktree_branch);
    expect(branches).toContain("feat/a");
    expect(branches).toContain("feat/b");
  });

  it("filters by repository_id", () => {
    const repo1 = registerRepository({ path: makeFakeGitRepo() });
    const repo2 = registerRepository({ path: makeFakeGitRepo() });
    createSession({
      repository_id: repo1.id,
      worktree_branch: "feat/a",
      goal: "A",
      completion_condition: "Done",
    });
    createSession({
      repository_id: repo2.id,
      worktree_branch: "feat/b",
      goal: "B",
      completion_condition: "Done",
    });

    const sessions = listSessions({ repository_id: repo1.id });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].worktree_branch).toBe("feat/a");
  });

  it("filters by worktree_branch", () => {
    const repo = registerRepository({ path: makeFakeGitRepo() });
    createSession({
      repository_id: repo.id,
      worktree_branch: "feat/a",
      goal: "A",
      completion_condition: "Done",
    });
    createSession({
      repository_id: repo.id,
      worktree_branch: "feat/b",
      goal: "B",
      completion_condition: "Done",
    });

    const sessions = listSessions({ worktree_branch: "feat/a" });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].goal).toBe("A");
  });

  it("filters by status", () => {
    const repo = registerRepository({ path: makeFakeGitRepo() });
    const session = createSession({
      repository_id: repo.id,
      worktree_branch: "feat/a",
      goal: "A",
      completion_condition: "Done",
    });
    failSession(session.id);
    createSession({
      repository_id: repo.id,
      worktree_branch: "feat/b",
      goal: "B",
      completion_condition: "Done",
    });

    expect(listSessions({ status: "RUNNING" })).toHaveLength(1);
    expect(listSessions({ status: "FAILED" })).toHaveLength(1);
  });
});

describe("getSession", () => {
  it("returns the session by id", () => {
    const repo = registerRepository({ path: makeFakeGitRepo() });
    const created = createSession({
      repository_id: repo.id,
      worktree_branch: "feat/a",
      goal: "A",
      completion_condition: "Done",
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
  it("marks a RUNNING session as FAILED", () => {
    const repo = registerRepository({ path: makeFakeGitRepo() });
    const session = createSession({
      repository_id: repo.id,
      worktree_branch: "feat/a",
      goal: "A",
      completion_condition: "Done",
    });

    const failed = failSession(session.id);
    expect(failed.status).toBe("FAILED");
  });

  it("throws when session is not found", () => {
    expect(() => failSession("nonexistent")).toThrow("Session not found");
  });

  it("throws when session is already in a terminal state", () => {
    const repo = registerRepository({ path: makeFakeGitRepo() });
    const session = createSession({
      repository_id: repo.id,
      worktree_branch: "feat/a",
      goal: "A",
      completion_condition: "Done",
    });
    failSession(session.id);

    expect(() => failSession(session.id)).toThrow("terminal state");
  });
});
