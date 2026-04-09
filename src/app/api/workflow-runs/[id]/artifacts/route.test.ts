import { mkdir, writeFile } from "fs/promises";
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

let configFile: string;

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
    ],
  );
});

describe("GET /api/workflow-runs/:id/artifacts", () => {
  it("returns exists: true for artifacts that exist on disk", async () => {
    const repoPath = await makeFakeGitRepo();
    const run = await container.workflowRunService.createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });
    const artifactDir = join(repoPath, ".aitm", "runs", run.id, "artifacts");
    await mkdir(join(artifactDir, "notes"), { recursive: true });
    await writeFile(join(artifactDir, "plan.md"), "# Plan\n");

    const res = await GET(
      new NextRequest(`http://localhost/api/workflow-runs/${run.id}/artifacts`),
      makeParams(run.id),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      {
        name: "plan",
        path: "plan.md",
        description: "Shared working plan for the run",
        exists: true,
      },
      {
        name: "notes",
        path: "notes/context.json",
        exists: false,
      },
    ]);
  });

  it("returns exists: false for all artifacts when none exist on disk", async () => {
    const repoPath = await makeFakeGitRepo();
    const run = await container.workflowRunService.createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    const res = await GET(
      new NextRequest(`http://localhost/api/workflow-runs/${run.id}/artifacts`),
      makeParams(run.id),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      {
        name: "plan",
        path: "plan.md",
        description: "Shared working plan for the run",
        exists: false,
      },
      {
        name: "notes",
        path: "notes/context.json",
        exists: false,
      },
    ]);
  });

  it("returns 404 when workflow run is not found", async () => {
    const res = await GET(
      new NextRequest(
        "http://localhost/api/workflow-runs/nonexistent/artifacts",
      ),
      makeParams("nonexistent"),
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: "Workflow run not found",
    });
  });
});
