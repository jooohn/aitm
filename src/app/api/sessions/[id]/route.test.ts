import { mkdir } from "fs/promises";
import { NextRequest } from "next/server";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentService, sessionService } from "@/backend/container";

const createSession = sessionService.createSession.bind(sessionService);

import { db } from "@/backend/infra/db";
import { GET } from "./route";

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

beforeEach(() => {
  vi.spyOn(agentService, "startAgent").mockResolvedValue(undefined);
  db.prepare("DELETE FROM sessions").run();
});

describe("GET /api/sessions/:id", () => {
  it("returns 200 with the session", async () => {
    const session = await createSession({
      repository_path: await makeFakeGitRepo(),
      worktree_branch: "feat/test",
      goal: "Do something",
      transitions: [{ terminal: "success" as const, when: "Done" }],
    });

    const res = await GET(
      new NextRequest(`http://localhost/api/sessions/${session.id}`),
      makeParams(session.id),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(session.id);
    expect(body.goal).toBe("Do something");
  });

  it("includes state_execution_id in the response", async () => {
    const session = await createSession({
      repository_path: await makeFakeGitRepo(),
      worktree_branch: "feat/test",
      goal: "Do something",
      transitions: [{ terminal: "success" as const, when: "Done" }],
    });

    const res = await GET(
      new NextRequest(`http://localhost/api/sessions/${session.id}`),
      makeParams(session.id),
    );
    const body = await res.json();
    expect(body).toHaveProperty("state_execution_id");
    expect(body.state_execution_id).toBeNull();
  });

  it("returns 404 for unknown id", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/sessions/nonexistent"),
      makeParams("nonexistent"),
    );
    expect(res.status).toBe(404);
  });
});
