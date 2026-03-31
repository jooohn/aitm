import { mkdirSync, writeFileSync } from "fs";
import { NextRequest } from "next/server";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  completeStateExecution,
  createWorkflowRun,
} from "@/lib/domain/workflow-runs";
import { db } from "@/lib/infra/db";
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
  return new NextRequest(
    `http://localhost/api/workflow-runs/${id}/rerun-from-failed`,
    { method: "POST" },
  );
}

function setupFailedRun() {
  const repoPath = makeFakeGitRepo();
  const run = createWorkflowRun({
    repository_path: repoPath,
    worktree_branch: "feat/test",
    workflow_name: "my-flow",
  });

  const [planExec] = db
    .prepare(
      "SELECT * FROM state_executions WHERE workflow_run_id = ? ORDER BY created_at ASC",
    )
    .all(run.id) as { id: string }[];
  completeStateExecution(planExec.id, {
    transition: "implement",
    reason: "Plan done",
    handoff_summary: "Wrote PLAN.md",
  });

  const implementExec = db
    .prepare(
      "SELECT * FROM state_executions WHERE workflow_run_id = ? AND state = 'implement'",
    )
    .get(run.id) as { id: string };
  completeStateExecution(implementExec.id, {
    transition: "failure",
    reason: "Blocked",
    handoff_summary: "Could not proceed",
  });

  return { run, repoPath };
}

describe("POST /api/workflow-runs/:id/rerun-from-failed", () => {
  it("returns 200 with the updated workflow run when run is in failure status", async () => {
    const { run } = setupFailedRun();

    const res = await POST(makeRequest(run.id), makeParams(run.id));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(run.id);
    expect(body.status).toBe("running");
    expect(body.current_state).toBe("implement");
    expect(Array.isArray(body.state_executions)).toBe(true);
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
         (id, repository_path, worktree_branch, workflow_name, current_state, status, inputs, created_at, updated_at)
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
