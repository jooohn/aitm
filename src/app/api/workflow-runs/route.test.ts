import { mkdir } from "fs/promises";
import { NextRequest } from "next/server";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as container from "@/backend/container";
import { db } from "@/backend/infra/db";
import { inferAlias } from "@/lib/utils/inferAlias";
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

async function setupConfig(content: string, repoPaths: string[] = []) {
  const repoLines = repoPaths.map((p) => `  - path: "${p}"`).join("\n");
  const fullContent = repoLines
    ? `repositories:\n${repoLines}\n${content}`
    : content;
  await writeTestConfig(configFile, fullContent);
  container.initializeContainer();
  vi.spyOn(container.agentService, "startAgent").mockResolvedValue(undefined);
  vi.spyOn(container.worktreeService, "listWorktrees").mockImplementation(
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
}

beforeEach(async () => {
  configFile = await setupTestConfigDir();

  db.prepare("DELETE FROM sessions").run();
  db.prepare("DELETE FROM step_executions").run();
  db.prepare("DELETE FROM workflow_runs").run();
});

describe("POST /api/workflow-runs", () => {
  it("creates a workflow run with organization/name and returns 201", async () => {
    const repoPath = await makeFakeGitRepo();
    const alias = inferAlias(repoPath);
    const [organization, name] = alias.split("/");
    await setupConfig(
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
      [repoPath],
    );

    const res = await POST(
      new NextRequest("http://localhost/api/workflow-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization,
          name,
          worktree_branch: "feat/test",
          workflow_name: "my-flow",
        }),
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.organization).toBe(organization);
    expect(body.name).toBe(name);
    expect(body).not.toHaveProperty("repository_path");
    expect(body.worktree_branch).toBe("feat/test");
    expect(body.workflow_name).toBe("my-flow");
    expect(body.status).toBe("running");
    expect(body.current_step).toBe("plan");
  });

  it("returns 422 when required fields are missing", async () => {
    await setupConfig("workflows: {}\n");
    const res = await POST(
      new NextRequest("http://localhost/api/workflow-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization: "org" }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("returns 404 when repository is not found", async () => {
    await setupConfig("workflows: {}\n");
    const res = await POST(
      new NextRequest("http://localhost/api/workflow-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization: "nonexistent-org",
          name: "nonexistent-repo",
          worktree_branch: "feat/test",
          workflow_name: "my-flow",
        }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when workflow is not found in config", async () => {
    const repoPath = await makeFakeGitRepo();
    const alias = inferAlias(repoPath);
    const [organization, name] = alias.split("/");
    await setupConfig("workflows: {}\n", [repoPath]);
    const res = await POST(
      new NextRequest("http://localhost/api/workflow-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization,
          name,
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
    const repoPath = await makeFakeGitRepo();
    const alias = inferAlias(repoPath);
    const [organization, name] = alias.split("/");
    await setupConfig(
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
      [repoPath],
    );

    // Create one run directly
    await POST(
      new NextRequest("http://localhost/api/workflow-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization,
          name,
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

  it("filters by organization/name", async () => {
    const repoA = await makeFakeGitRepo();
    const repoB = await makeFakeGitRepo();
    const aliasA = inferAlias(repoA);
    const [orgA, nameA] = aliasA.split("/");
    const aliasB = inferAlias(repoB);
    const [orgB, nameB] = aliasB.split("/");
    await setupConfig(
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
      [repoA, repoB],
    );

    await POST(
      new NextRequest("http://localhost/api/workflow-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization: orgA,
          name: nameA,
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
          organization: orgB,
          name: nameB,
          worktree_branch: "feat/b",
          workflow_name: "my-flow",
        }),
      }),
    );

    const res = await GET(
      new NextRequest(
        `http://localhost/api/workflow-runs?organization=${orgA}&name=${nameA}`,
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].organization).toBe(orgA);
    expect(body[0].name).toBe(nameA);
    expect(body[0]).not.toHaveProperty("repository_path");
  });

  it("returns empty array when organization/name do not match any repository", async () => {
    const repoPath = await makeFakeGitRepo();
    const alias = inferAlias(repoPath);
    const [organization, name] = alias.split("/");
    await setupConfig(
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
      [repoPath],
    );

    // Create a run
    await POST(
      new NextRequest("http://localhost/api/workflow-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization,
          name,
          worktree_branch: "feat/a",
          workflow_name: "my-flow",
        }),
      }),
    );

    // Query with non-existent org/name should return empty, not all runs
    const res = await GET(
      new NextRequest(
        "http://localhost/api/workflow-runs?organization=nonexistent&name=repo",
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(0);
  });
});
