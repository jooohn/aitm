import { mkdir } from "fs/promises";
import { NextRequest } from "next/server";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as container from "@/backend/container";
import { db } from "@/backend/infra/db";
import { setupTestConfigDir, writeTestConfig } from "@/test-config-helper";
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

beforeEach(async () => {
  const configFile = await setupTestConfigDir();
  await writeTestConfig(configFile, "workflows: {}\n");
  container.initializeContainer();
  vi.spyOn(container.agentService, "startAgent").mockResolvedValue(undefined);
  db.prepare("DELETE FROM sessions").run();
});

describe("GET /api/sessions/:id", () => {
  it("returns 200 with the session", async () => {
    const session = await container.sessionService.createSession({
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
    expect(body.transitions).toEqual([{ terminal: "success", when: "Done" }]);
  });

  it("includes step_execution_id in the response", async () => {
    const session = await container.sessionService.createSession({
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
    expect(body).toHaveProperty("step_execution_id");
    expect(body.step_execution_id).toBeNull();
  });

  it("returns typed metadata fields instead of JSON strings", async () => {
    const session = await container.sessionService.createSession({
      repository_path: await makeFakeGitRepo(),
      worktree_branch: "feat/test",
      goal: "Do something",
      transitions: [{ terminal: "success" as const, when: "Done" }],
      metadata_fields: {
        pr_url: {
          type: "string",
          description: "Pull request URL",
        },
      },
    });

    const res = await GET(
      new NextRequest(`http://localhost/api/sessions/${session.id}`),
      makeParams(session.id),
    );

    const body = await res.json();
    expect(body.metadata_fields).toEqual({
      pr_url: {
        type: "string",
        description: "Pull request URL",
      },
    });
  });

  it("returns 404 for unknown id", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/sessions/nonexistent"),
      makeParams("nonexistent"),
    );
    expect(res.status).toBe(404);
  });
});
