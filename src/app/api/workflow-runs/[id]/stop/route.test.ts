import { mkdirSync, writeFileSync } from "fs";
import { NextRequest } from "next/server";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/utils/agent", () => ({
  cancelAgent: vi.fn(),
  sendMessageToAgent: vi.fn(),
  startAgent: vi.fn(async () => {}),
}));

import { workflowRunService } from "@/backend/container";

const createWorkflowRun =
  workflowRunService.createWorkflowRun.bind(workflowRunService);
const completeStateExecution =
  workflowRunService.completeStateExecution.bind(workflowRunService);

import { db } from "@/backend/infra/db";
import { POST } from "./route";

function makeFakeGitRepo(): string {
  const dir = join(
    tmpdir(),
    `aitm-test-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

const WORKFLOW_CONFIG = `
workflows:
  my-flow:
    initial_state: plan
    states:
      plan:
        goal: "Write a plan"
        transitions:
          - state: implement
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

beforeEach(() => {
  const dir = join(
    tmpdir(),
    `aitm-config-test-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  configFile = join(dir, "config.yaml");
  process.env.AITM_CONFIG_PATH = configFile;
  writeFileSync(configFile, WORKFLOW_CONFIG);

  db.prepare("DELETE FROM session_messages").run();
  db.prepare("DELETE FROM sessions").run();
  db.prepare("DELETE FROM state_executions").run();
  db.prepare("DELETE FROM workflow_runs").run();
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
    const repoPath = makeFakeGitRepo();
    const run = createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    const res = await POST(makeRequest(run.id), makeParams(run.id));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(run.id);
    expect(body.status).toBe("failure");
    expect(body.current_state).toBeNull();
  });

  it("returns 404 for unknown id", async () => {
    const res = await POST(
      makeRequest("nonexistent"),
      makeParams("nonexistent"),
    );

    expect(res.status).toBe(404);
  });

  it("returns 422 when the workflow run is already terminal", async () => {
    const repoPath = makeFakeGitRepo();
    const run = createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });
    const [execution] = db
      .prepare("SELECT * FROM state_executions WHERE workflow_run_id = ?")
      .all(run.id) as { id: string }[];
    completeStateExecution(execution.id, {
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
    const repoPath = makeFakeGitRepo();
    const run = createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });
    const [execution] = db
      .prepare("SELECT * FROM state_executions WHERE workflow_run_id = ?")
      .all(run.id) as { id: string }[];
    const session = db
      .prepare("SELECT * FROM sessions WHERE state_execution_id = ?")
      .get(execution.id) as { id: string };
    db.prepare("UPDATE sessions SET status = 'SUCCEEDED' WHERE id = ?").run(
      session.id,
    );

    const res = await POST(makeRequest(run.id), makeParams(run.id));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(run.id);
    expect(body.status).toBe("failure");
    expect(body.current_state).toBeNull();
  });
});
