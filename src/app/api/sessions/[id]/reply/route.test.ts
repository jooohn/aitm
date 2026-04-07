import { mkdir } from "fs/promises";
import { NextRequest } from "next/server";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as container from "@/backend/container";
import { db } from "@/backend/infra/db";
import { setupTestConfigDir, writeTestConfig } from "@/test-config-helper";
import { POST } from "./route";

async function makeFakeGitRepo(): Promise<string> {
  const dir = join(
    tmpdir(),
    `aitm-test-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(join(dir, ".git"), { recursive: true });
  return dir;
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(async () => {
  const configFile = await setupTestConfigDir();
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
    ],
  );
});

describe("POST /api/sessions/:id/reply", () => {
  it("returns 200 and calls resumeAgent for AWAITING_INPUT session", async () => {
    const session = await container.sessionService.createSession({
      repository_path: await makeFakeGitRepo(),
      worktree_branch: "feat/test",
      goal: "Do something",
      transitions: [{ terminal: "success" as const, when: "Done" }],
    });
    db.prepare(
      "UPDATE sessions SET status = 'awaiting_input' WHERE id = ?",
    ).run(session.id);

    const res = await POST(
      new NextRequest(`http://localhost/api/sessions/${session.id}/reply`, {
        method: "POST",
        body: JSON.stringify({ message: "Use PostgreSQL" }),
      }),
      makeParams(session.id),
    );

    expect(res.status).toBe(200);
    expect(container.agentService.resumeAgent).toHaveBeenCalledWith(
      session.id,
      "Use PostgreSQL",
      session.repository_path,
      [{ terminal: "success", when: "Done" }],
      { provider: "claude" },
      session.log_file_path,
      undefined,
      undefined,
    );
  });

  it("returns 404 for unknown session", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/sessions/nonexistent/reply", {
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
      }),
      makeParams("nonexistent"),
    );

    expect(res.status).toBe(404);
  });

  it("returns 422 when session is not AWAITING_INPUT", async () => {
    const session = await container.sessionService.createSession({
      repository_path: await makeFakeGitRepo(),
      worktree_branch: "feat/test",
      goal: "Do something",
      transitions: [{ terminal: "success" as const, when: "Done" }],
    });

    const res = await POST(
      new NextRequest(`http://localhost/api/sessions/${session.id}/reply`, {
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
      }),
      makeParams(session.id),
    );

    expect(res.status).toBe(422);
  });

  it("returns 400 when message is missing", async () => {
    const session = await container.sessionService.createSession({
      repository_path: await makeFakeGitRepo(),
      worktree_branch: "feat/test",
      goal: "Do something",
      transitions: [{ terminal: "success" as const, when: "Done" }],
    });
    db.prepare(
      "UPDATE sessions SET status = 'awaiting_input' WHERE id = ?",
    ).run(session.id);

    const res = await POST(
      new NextRequest(`http://localhost/api/sessions/${session.id}/reply`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
      makeParams(session.id),
    );

    expect(res.status).toBe(400);
  });
});
