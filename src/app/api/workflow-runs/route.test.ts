import { mkdirSync, writeFileSync } from "fs";
import { NextRequest } from "next/server";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET, POST } from "./route";

function makeFakeGitRepo(): string {
  const dir = join(
    tmpdir(),
    `aitm-test-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

let configFile: string;

beforeEach(() => {
  const dir = join(
    tmpdir(),
    `aitm-config-test-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  configFile = join(dir, "config.yaml");
  process.env.AITM_CONFIG_PATH = configFile;

  db.prepare("DELETE FROM state_executions").run();
  db.prepare("DELETE FROM workflow_runs").run();
  db.prepare("DELETE FROM session_messages").run();
  db.prepare("DELETE FROM sessions").run();
});

afterEach(() => {
  delete process.env.AITM_CONFIG_PATH;
});

describe("POST /api/workflow-runs", () => {
  it("creates a workflow run and returns 201", async () => {
    const repoPath = makeFakeGitRepo();
    writeFileSync(
      configFile,
      `
workflows:
  my-flow:
    initial_state: plan
    states:
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
    expect(body.current_state).toBe("plan");
  });

  it("returns 422 when required fields are missing", async () => {
    writeFileSync(configFile, "");
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
    const repoPath = makeFakeGitRepo();
    writeFileSync(configFile, "workflows: {}\n");
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
    writeFileSync(
      configFile,
      `
workflows:
  my-flow:
    initial_state: plan
    states:
      plan:
        goal: "Write a plan"
        transitions:
          - terminal: success
            when: "done"
`,
    );
    const repoPath = makeFakeGitRepo();

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
    writeFileSync(
      configFile,
      `
workflows:
  my-flow:
    initial_state: plan
    states:
      plan:
        goal: "Write a plan"
        transitions:
          - terminal: success
            when: "done"
`,
    );
    const repoA = makeFakeGitRepo();
    const repoB = makeFakeGitRepo();

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
