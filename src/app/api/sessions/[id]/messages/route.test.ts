import { mkdirSync } from "fs";
import { NextRequest } from "next/server";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { registerRepository } from "@/lib/repositories";
import { createSession, saveMessage } from "@/lib/sessions";
import { GET } from "./route";

function makeFakeGitRepo(): string {
  const dir = join(
    tmpdir(),
    `aitm-test-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  db.prepare("DELETE FROM session_messages").run();
  db.prepare("DELETE FROM sessions").run();
  db.prepare("DELETE FROM repositories").run();
});

describe("GET /api/sessions/:id/messages", () => {
  it("returns 200 with messages in order", async () => {
    const repo = registerRepository({ path: makeFakeGitRepo() });
    const session = createSession({
      repository_id: repo.id,
      worktree_branch: "feat/test",
      goal: "Do something",
      completion_condition: "Done",
    });
    saveMessage(session.id, "agent", "First question");
    saveMessage(session.id, "user", "My answer");

    const res = await GET(
      new NextRequest(`http://localhost/api/sessions/${session.id}/messages`),
      makeParams(session.id),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].role).toBe("agent");
    expect(body[0].content).toBe("First question");
    expect(body[1].role).toBe("user");
    expect(body[1].content).toBe("My answer");
  });

  it("returns 200 with empty array when no messages", async () => {
    const repo = registerRepository({ path: makeFakeGitRepo() });
    const session = createSession({
      repository_id: repo.id,
      worktree_branch: "feat/test",
      goal: "Do something",
      completion_condition: "Done",
    });

    const res = await GET(
      new NextRequest(`http://localhost/api/sessions/${session.id}/messages`),
      makeParams(session.id),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns 404 for unknown session", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/sessions/nope/messages"),
      makeParams("nope"),
    );
    expect(res.status).toBe(404);
  });
});
