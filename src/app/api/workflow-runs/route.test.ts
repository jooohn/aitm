import { mkdir } from "fs/promises";
import { NextRequest } from "next/server";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { worktreeService } from "@/backend/container";
import { db } from "@/backend/infra/db";
import { setupTestConfigDir, writeTestConfig } from "@/test-config-helper";
import { GET, POST } from "./route";

async function makeFakeGitRepo(): Promise<string> {
  const dir = join(
    tmpdir(),
    `aitm-test-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(join(dir, ".git"), { recursive: true });
  return dir;
}

let configFile: string;

beforeEach(async () => {
  configFile = await setupTestConfigDir();

  db.prepare("DELETE FROM sessions").run();
  db.prepare("DELETE FROM step_executions").run();
  db.prepare("DELETE FROM workflow_runs").run();

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
});

describe("POST /api/workflow-runs", () => {
  it("creates a workflow run and returns 201", async () => {
    const repoPath = await makeFakeGitRepo();
    await writeTestConfig(
      configFile,
      `
workflows:
  my-flow:
    initial_step: plan
    steps:
      plan:
        goal: "Write a plan"
        transitions:
          - terminal: success
            when: "done"
`,
    );

    const res = await POST(
      new NextRequest("http://localhost/api/workflow-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repository_path: repoPath,
          worktree_branch: "feat/test",
          workflow_name: "my-flow",
        }),
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.repository_path).toBe(repoPath);
    expect(body.worktree_branch).toBe("feat/test");
    expect(body.workflow_name).toBe("my-flow");
    expect(body.status).toBe("running");
    expect(body.current_step).toBe("plan");
  });

  it("returns 422 when required fields are missing", async () => {
    await writeTestConfig(configFile, "workflows: {}\n");
    const res = await POST(
      new NextRequest("http://localhost/api/workflow-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repository_path: "/some/path" }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("returns 404 when workflow is not found in config", async () => {
    const repoPath = await makeFakeGitRepo();
    await writeTestConfig(configFile, "workflows: {}\n");
    const res = await POST(
      new NextRequest("http://localhost/api/workflow-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repository_path: repoPath,
          worktree_branch: "feat/test",
          workflow_name: "nonexistent-flow",
        }),
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/workflow-runs", () => {
  it("returns 200 with all workflow runs", async () => {
    await writeTestConfig(
      configFile,
      `
workflows:
  my-flow:
    initial_step: plan
    steps:
      plan:
        goal: "Write a plan"
        transitions:
          - terminal: success
            when: "done"
`,
    );
    const repoPath = await makeFakeGitRepo();

    // Create one run directly
    await POST(
      new NextRequest("http://localhost/api/workflow-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repository_path: repoPath,
          worktree_branch: "feat/a",
          workflow_name: "my-flow",
        }),
      }),
    );

    const res = await GET(
      new NextRequest("http://localhost/api/workflow-runs"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
  });

  it("filters by repository_path and worktree_branch", async () => {
    await writeTestConfig(
      configFile,
      `
workflows:
  my-flow:
    initial_step: plan
    steps:
      plan:
        goal: "Write a plan"
        transitions:
          - terminal: success
            when: "done"
`,
    );
    const repoA = await makeFakeGitRepo();
    const repoB = await makeFakeGitRepo();

    await POST(
      new NextRequest("http://localhost/api/workflow-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repository_path: repoA,
          worktree_branch: "feat/a",
          workflow_name: "my-flow",
        }),
      }),
    );
    await POST(
      new NextRequest("http://localhost/api/workflow-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repository_path: repoB,
          worktree_branch: "feat/b",
          workflow_name: "my-flow",
        }),
      }),
    );

    const encoded = encodeURIComponent(repoA);
    const res = await GET(
      new NextRequest(
        `http://localhost/api/workflow-runs?repository_path=${encoded}`,
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].repository_path).toBe(repoA);
  });
});
