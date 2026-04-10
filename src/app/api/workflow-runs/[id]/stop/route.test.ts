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

  vi.spyOn(getContainer().agentService, "startAgent").mockResolvedValue();
  vi.spyOn(getContainer().agentService, "cancelAgent").mockImplementation(
    () => {},
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
  return new NextRequest(`http://localhost/api/workflow-runs/${id}/stop`, {
    method: "POST",
  });
}

describe("POST /api/workflow-runs/:id/stop", () => {
  it("returns 200 with the failed workflow run", async () => {
    const repoPath = await makeFakeGitRepo();
    const run = await getContainer().workflowRunService.createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    const res = await POST(makeRequest(run.id), makeParams(run.id));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(run.id);
    expect(body.status).toBe("failure");
    expect(body.current_step).toBe("plan");
  });

  it("returns 404 for unknown id", async () => {
    const res = await POST(
      makeRequest("nonexistent"),
      makeParams("nonexistent"),
    );

    expect(res.status).toBe(404);
  });

  it("returns 422 when the workflow run is already terminal", async () => {
    const repoPath = await makeFakeGitRepo();
    const run = await getContainer().workflowRunService.createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });
    const [execution] = db
      .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
      .all(run.id) as { id: string }[];
    await getContainer().workflowRunService.completeStepExecution(
      execution.id,
      {
        transition: "failure",
        reason: "Blocked",
        handoff_summary: "Could not proceed",
      },
    );

    const res = await POST(makeRequest(run.id), makeParams(run.id));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("Workflow run is already in a terminal state");
  });

  it("returns 200 when the active session already reached SUCCEEDED", async () => {
    const repoPath = await makeFakeGitRepo();
    const run = await getContainer().workflowRunService.createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });
    const [execution] = db
      .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
      .all(run.id) as { id: string }[];
    const session = db
      .prepare("SELECT * FROM sessions WHERE step_execution_id = ?")
      .get(execution.id) as { id: string };
    db.prepare("UPDATE sessions SET status = 'SUCCEEDED' WHERE id = ?").run(
      session.id,
    );

    const res = await POST(makeRequest(run.id), makeParams(run.id));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(run.id);
    expect(body.status).toBe("failure");
    expect(body.current_step).toBe("plan");
  });
});
