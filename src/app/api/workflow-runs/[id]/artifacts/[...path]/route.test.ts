import { mkdir, writeFile } from "fs/promises";
import { NextRequest } from "next/server";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as container from "@/backend/container";
import { db } from "@/backend/infra/db";
import { setupTestConfigDir, writeTestConfig } from "@/test-config-helper";
import { GET } from "./route";

async function makeFakeDir(): Promise<string> {
  const dir = join(
    tmpdir(),
    `aitm-test-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

async function makeFakeGitRepo(): Promise<string> {
  const dir = await makeFakeDir();
  await mkdir(join(dir, ".git"), { recursive: true });
  return dir;
}

function makeParams(
  id: string,
  path: string[],
): { params: Promise<{ id: string; path: string[] }> } {
  return { params: Promise.resolve({ id, path }) };
}

let configFile: string;
let worktreePath: string;

beforeEach(async () => {
  configFile = await setupTestConfigDir();
  await writeTestConfig(
    configFile,
    `
workflows:
  my-flow:
    initial_step: plan
    artifacts:
      plan:
        path: plan.md
        description: Shared working plan for the run
      notes:
        path: notes/context.json
    steps:
      plan:
        goal: "Write a plan"
        transitions:
          - terminal: success
            when: "done"
`,
  );
  container.initializeContainer();

  db.prepare("DELETE FROM sessions").run();
  db.prepare("DELETE FROM step_executions").run();
  db.prepare("DELETE FROM workflow_runs").run();

  // Use a separate directory for worktree path to ensure the endpoint
  // resolves artifacts from the worktree, not from repository_path.
  worktreePath = await makeFakeGitRepo();

  vi.spyOn(container.agentService, "startAgent").mockResolvedValue(undefined);
  vi.spyOn(container.worktreeService, "listWorktrees").mockImplementation(
    async (_repoPath) => [
      {
        branch: "feat/test",
        path: worktreePath,
        is_main: false,
        is_bare: false,
        head: "HEAD",
      },
    ],
  );
});

describe("GET /api/workflow-runs/:id/artifacts/:path*", () => {
  it("serves a declared run artifact as an inline raw response", async () => {
    const repoPath = await makeFakeGitRepo();
    const run = await container.workflowRunService.createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });
    // Artifact is materialized in the worktree directory, not the repo root.
    const artifactPath = join(
      worktreePath,
      ".aitm",
      "runs",
      run.id,
      "artifacts",
      "plan.md",
    );
    await mkdir(join(worktreePath, ".aitm", "runs", run.id, "artifacts"), {
      recursive: true,
    });
    await writeFile(artifactPath, "# Plan\n");

    const res = await GET(
      new NextRequest(
        `http://localhost/api/workflow-runs/${run.id}/artifacts/plan.md`,
      ),
      makeParams(run.id, ["plan.md"]),
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("# Plan\n");
    expect(res.headers.get("Content-Type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(res.headers.get("Content-Disposition")).toBe(
      'inline; filename="plan.md"',
    );
  });

  it("returns 404 when the artifact is not declared for the workflow", async () => {
    const repoPath = await makeFakeGitRepo();
    const run = await container.workflowRunService.createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    const res = await GET(
      new NextRequest(
        `http://localhost/api/workflow-runs/${run.id}/artifacts/secret.txt`,
      ),
      makeParams(run.id, ["secret.txt"]),
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: "Artifact not found",
    });
  });

  it("returns 400 when the requested path escapes the artifact root", async () => {
    const repoPath = await makeFakeGitRepo();
    const run = await container.workflowRunService.createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    const res = await GET(
      new NextRequest(
        `http://localhost/api/workflow-runs/${run.id}/artifacts/../plan.md`,
      ),
      makeParams(run.id, ["..", "plan.md"]),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Invalid artifact path",
    });
  });
});
