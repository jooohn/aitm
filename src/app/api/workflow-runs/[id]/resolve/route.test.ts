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

const APPROVAL_WORKFLOW_CONFIG = `
workflows:
  approval-flow:
    initial_step: review
    steps:
      review:
        type: manual-approval
        transitions:
          - step: deploy
            when: approved
          - terminal: failure
            when: rejected
      deploy:
        goal: "Deploy the code"
        transitions:
          - terminal: success
            when: done
`;

const AGENT_WORKFLOW_CONFIG = `
workflows:
  my-flow:
    initial_step: plan
    steps:
      plan:
        goal: "Write a plan"
        transitions:
          - terminal: success
            when: "done"
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
  await writeFile(configFile, APPROVAL_WORKFLOW_CONFIG);

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

function makeRequest(id: string, body: { decision: string }): NextRequest {
  return new NextRequest(`http://localhost/api/workflow-runs/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/workflow-runs/:id/resolve", () => {
  it("returns 200 and advances workflow when approved", async () => {
    const repoPath = await makeFakeGitRepo();
    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "approval-flow",
    });

    const res = await POST(
      makeRequest(run.id, { decision: "approved" }),
      makeParams(run.id),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(run.id);
    expect(body.status).toBe("running");
    expect(body.current_step).toBe("deploy");
  });

  it("returns 200 and terminates workflow when rejected", async () => {
    const repoPath = await makeFakeGitRepo();
    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "approval-flow",
    });

    const res = await POST(
      makeRequest(run.id, { decision: "rejected" }),
      makeParams(run.id),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(run.id);
    expect(body.status).toBe("failure");
  });

  it("returns 404 for unknown workflow run id", async () => {
    const res = await POST(
      makeRequest("nonexistent", { decision: "approved" }),
      makeParams("nonexistent"),
    );

    expect(res.status).toBe(404);
  });

  it("returns 422 when workflow run is not running", async () => {
    const repoPath = await makeFakeGitRepo();
    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "approval-flow",
    });

    // Complete the step to terminate the workflow
    const [execution] = db
      .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
      .all(run.id) as { id: string }[];
    await completeStepExecution(execution.id, {
      transition: "failure",
      reason: "Rejected",
      handoff_summary: "",
    });

    const res = await POST(
      makeRequest(run.id, { decision: "approved" }),
      makeParams(run.id),
    );

    expect(res.status).toBe(422);
  });

  it("returns 422 when active step is not manual-approval", async () => {
    await writeFile(configFile, AGENT_WORKFLOW_CONFIG);

    const repoPath = await makeFakeGitRepo();
    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    const res = await POST(
      makeRequest(run.id, { decision: "approved" }),
      makeParams(run.id),
    );

    expect(res.status).toBe(422);
  });

  it("returns 400 for invalid decision value", async () => {
    const repoPath = await makeFakeGitRepo();
    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "approval-flow",
    });

    const res = await POST(
      makeRequest(run.id, { decision: "maybe" }),
      makeParams(run.id),
    );

    expect(res.status).toBe(400);
  });
});
