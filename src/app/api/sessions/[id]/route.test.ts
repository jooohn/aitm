import { mkdirSync } from "fs";
import { NextRequest } from "next/server";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { createSession } from "@/lib/domain/sessions";
import { db } from "@/lib/infra/db";
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
});

describe("GET /api/sessions/:id", () => {
  it("returns 200 with the session", async () => {
    const session = createSession({
      repository_path: makeFakeGitRepo(),
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

  it("returns 404 for unknown id", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/sessions/nonexistent"),
      makeParams("nonexistent"),
    );
    expect(res.status).toBe(404);
  });
});
