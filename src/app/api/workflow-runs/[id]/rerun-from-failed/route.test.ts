import { mkdir } from "fs/promises";
import { NextRequest } from "next/server";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getContainer, initializeContainer } from "@/backend/container";
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

const WORKFLOW_CONFIG = `
workflows:
  my-flow:
    initial_step: plan
    steps:
      plan:
        goal: "Write a plan"
        transitions:
          - step: implement
            when: "plan is ready"
          - terminal: failure
            when: "cannot proceed"
      implement:
        goal: "Write the code"
        transitions:
          - terminal: success
            when: "code is done"
          - terminal: failure
            when: "blocked"
`;

beforeEach(async () => {
  const configFile = await setupTestConfigDir();
  await writeTestConfig(configFile, WORKFLOW_CONFIG);
  initializeContainer();

  db.prepare("DELETE FROM sessions").run();
  db.prepare("DELETE FROM step_executions").run();
  db.prepare("DELETE FROM workflow_runs").run();

  vi.spyOn(getContainer().agentService, "startAgent").mockResolvedValue(
    undefined,
  );
  vi.spyOn(getContainer().worktreeService, "listWorktrees").mockImplementation(
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

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(id: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/workflow-runs/${id}/rerun-from-failed`,
    { method: "POST" },
  );
}

async function setupFailedRun() {
  const repoPath = await makeFakeGitRepo();
  const run = await getContainer().workflowRunService.createWorkflowRun({
    repository_path: repoPath,
    worktree_branch: "feat/test",
    workflow_name: "my-flow",
  });

  const [planExec] = db
    .prepare(
      "SELECT * FROM step_executions WHERE workflow_run_id = ? ORDER BY created_at ASC",
    )
    .all(run.id) as { id: string }[];
  await getContainer().workflowRunService.completeStepExecution(planExec.id, {
    transition: "implement",
    reason: "Plan done",
    handoff_summary: "Wrote PLAN.md",
  });

  const implementExec = db
    .prepare(
      "SELECT * FROM step_executions WHERE workflow_run_id = ? AND step = 'implement'",
    )
    .get(run.id) as { id: string };
  await getContainer().workflowRunService.completeStepExecution(
    implementExec.id,
    {
      transition: "failure",
      reason: "Blocked",
      handoff_summary: "Could not proceed",
    },
  );

  return { run, repoPath };
}

describe("POST /api/workflow-runs/:id/rerun-from-failed", () => {
  it("returns 200 with the updated workflow run when run is in failure status", async () => {
    const { run } = await setupFailedRun();

    const res = await POST(makeRequest(run.id), makeParams(run.id));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(run.id);
    expect(body.status).toBe("running");
    expect(body.current_step).toBe("implement");
    expect(Array.isArray(body.step_executions)).toBe(true);
  });

  it("returns 404 for unknown id", async () => {
    const res = await POST(
      makeRequest("nonexistent"),
      makeParams("nonexistent"),
    );
    expect(res.status).toBe(404);
  });

  it("returns 422 when run is not in failure status", async () => {
    const now = new Date().toISOString();
    const id = "test-running-run-id";
    db.prepare(
      `INSERT INTO workflow_runs
         (id, repository_path, worktree_branch, workflow_name, current_step, status, inputs, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'running', NULL, ?, ?)`,
    ).run(id, "/repo", "feat/test", "my-flow", "plan", now, now);

    const res = await POST(makeRequest(id), makeParams(id));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe(
      "Only failed workflow runs can be re-run from failed state",
    );
  });
});
