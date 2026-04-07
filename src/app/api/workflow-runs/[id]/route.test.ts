import { mkdir } from "fs/promises";
import { NextRequest } from "next/server";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentService,
  workflowRunService,
  worktreeService,
} from "@/backend/container";

const createWorkflowRun =
  workflowRunService.createWorkflowRun.bind(workflowRunService);

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

let configFile: string;

beforeEach(async () => {
  configFile = await setupTestConfigDir();
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
          - step: implement
            when: "plan is ready"
          - terminal: failure
            when: "cannot proceed"
      implement:
        goal: "Write the code"
        transitions:
          - terminal: success
            when: "code is done"
  command-flow:
    initial_step: command-step
    steps:
      command-step:
        type: command
        command: "printf 'stdout line\\n' && printf 'stderr line\\n' >&2"
        transitions:
          - terminal: success
            when: "succeeded"
`,
  );

  db.prepare("DELETE FROM sessions").run();
  db.prepare("DELETE FROM step_executions").run();
  db.prepare("DELETE FROM workflow_runs").run();

  vi.spyOn(agentService, "startAgent").mockResolvedValue(undefined);
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

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/workflow-runs/:id", () => {
  it("returns 200 with the workflow run and its step executions", async () => {
    const repoPath = await makeFakeGitRepo();
    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
    });

    const res = await GET(
      new NextRequest(`http://localhost/api/workflow-runs/${run.id}`),
      makeParams(run.id),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(run.id);
    expect(body.workflow_name).toBe("my-flow");
    expect(Array.isArray(body.step_executions)).toBe(true);
    expect(body.step_executions).toHaveLength(1);
    expect(body.step_executions[0].step).toBe("plan");
    expect(body.step_executions[0].step_type).toBe("agent");
    expect(body.inputs).toBeNull();
    expect(body.metadata).toBeNull();
    expect(body.step_executions[0].transition_decision).toBeNull();
  });

  it("returns command step executions with explicit step_type and command output", async () => {
    const repoPath = await makeFakeGitRepo();
    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "command-flow",
    });

    const res = await GET(
      new NextRequest(`http://localhost/api/workflow-runs/${run.id}`),
      makeParams(run.id),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.step_executions).toHaveLength(1);
    expect(body.step_executions[0].step).toBe("command-step");
    expect(body.step_executions[0].step_type).toBe("command");
    expect(body.step_executions[0].command_output).toContain("stdout line");
    expect(body.step_executions[0].command_output).toContain("stderr line");
  });

  it("returns parsed inputs, metadata, and transition decisions", async () => {
    const repoPath = await makeFakeGitRepo();
    const run = await createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
      inputs: { ticket: "42" },
    });

    const [execution] = db
      .prepare("SELECT * FROM step_executions WHERE workflow_run_id = ?")
      .all(run.id) as { id: string }[];

    await workflowRunService.completeStepExecution(execution.id, {
      transition: "implement",
      reason: "Ready",
      handoff_summary: "Plan complete",
      metadata: {
        presets__pull_request_url: "https://github.com/org/repo/pull/42",
      },
    });

    const res = await GET(
      new NextRequest(`http://localhost/api/workflow-runs/${run.id}`),
      makeParams(run.id),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inputs).toEqual({ ticket: "42" });
    expect(body.metadata).toEqual({
      presets__pull_request_url: "https://github.com/org/repo/pull/42",
    });
    expect(body.step_executions[0].transition_decision).toEqual({
      transition: "implement",
      reason: "Ready",
      handoff_summary: "Plan complete",
      metadata: {
        presets__pull_request_url: "https://github.com/org/repo/pull/42",
      },
    });
  });

  it("returns 404 for unknown id", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/workflow-runs/nonexistent"),
      makeParams("nonexistent"),
    );
    expect(res.status).toBe(404);
  });
});
