import { mkdir, writeFile } from "fs/promises";
import { NextRequest } from "next/server";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  agentService,
  workflowRunService,
  worktreeService,
} from "@/backend/container";

vi.spyOn(agentService, "startAgent").mockResolvedValue();
vi.spyOn(agentService, "cancelAgent").mockImplementation(() => {});

const createWorkflowRun =
  workflowRunService.createWorkflowRun.bind(workflowRunService);
const completeStepExecution =
  workflowRunService.completeStepExecution.bind(workflowRunService);

import { db } from "@/backend/infra/db";
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

let configFile: string;

beforeEach(async () => {
  const dir = join(
    tmpdir(),
    `aitm-config-test-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  configFile = join(dir, "config.yaml");
  process.env.AITM_CONFIG_PATH = configFile;
  await writeFile(configFile, WORKFLOW_CONFIG);

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
    ],
  );
});

afterEach(() => {
  delete process.env.AITM_CONFIG_PATH;
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
    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    const res = await POST(makeRequest(run.id), makeParams(run.id));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(run.id);
    expect(body.status).toBe("failure");
    expect(body.current_step).toBeNull();
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
    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });
    const [execution] = db
      .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
      .all(run.id) as { id: string }[];
    await completeStepExecution(execution.id, {
      transition: "failure",
      reason: "Blocked",
      handoff_summary: "Could not proceed",
    });

    const res = await POST(makeRequest(run.id), makeParams(run.id));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("Workflow run is already in a terminal state");
  });

  it("returns 200 when the active session already reached SUCCEEDED", async () => {
    const repoPath = await makeFakeGitRepo();
    const run = await createWorkflowRun({
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
    expect(body.current_step).toBeNull();
  });
});
