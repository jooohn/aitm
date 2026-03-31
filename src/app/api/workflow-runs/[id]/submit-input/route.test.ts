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
  clarify-flow:
    initial_state: plan
    states:
      plan:
        goal: "Write a plan"
        transitions:
          - state: wait-for-clarification
            when: "needs clarification"
          - terminal: failure
            when: "blocked"
      wait-for-clarification:
        wait_for_input: true
        transitions:
          - state: plan
            when: "always"
`;

beforeEach(() => {
  const dir = join(
    tmpdir(),
    `aitm-config-test-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  const configFile = join(dir, "config.yaml");
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

function makeRequest(id: string, body: object): NextRequest {
  return new NextRequest(
    `http://localhost/api/workflow-runs/${id}/submit-input`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function setupWaitingRun() {
  const repoPath = makeFakeGitRepo();
  const run = createWorkflowRun({
    repository_path: repoPath,
    worktree_branch: "feat/test",
    workflow_name: "clarify-flow",
  });

  const [planExec] = db
    .prepare(
      "SELECT * FROM state_executions WHERE workflow_run_id = ? ORDER BY created_at ASC",
    )
    .all(run.id) as { id: string }[];
  completeStateExecution(planExec.id, {
    transition: "wait-for-clarification",
    reason: "Unclear spec",
    handoff_summary: "Please clarify the scope.",
  });

  return { run, repoPath };
}

describe("POST /api/workflow-runs/:id/submit-input", () => {
  it("returns 200 with updated run after submitting input", async () => {
    const { run } = setupWaitingRun();

    const res = await POST(
      makeRequest(run.id, { user_input: "The scope is X." }),
      makeParams(run.id),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(run.id);
    expect(body.status).toBe("running");
    expect(body.current_state).toBe("plan");
    expect(Array.isArray(body.state_executions)).toBe(true);
  });

  it("returns 404 for unknown run id", async () => {
    const res = await POST(
      makeRequest("nonexistent", { user_input: "hello" }),
      makeParams("nonexistent"),
    );
    expect(res.status).toBe(404);
  });

  it("returns 422 when run is not waiting for input", async () => {
    const repoPath = makeFakeGitRepo();
    const run = createWorkflowRun({
      repository_path: repoPath,
      worktree_branch: "feat/test",
      workflow_name: "clarify-flow",
    });

    const res = await POST(
      makeRequest(run.id, { user_input: "hello" }),
      makeParams(run.id),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/not waiting for input/);
  });

  it("returns 400 when user_input is missing", async () => {
    const { run } = setupWaitingRun();

    const res = await POST(makeRequest(run.id, {}), makeParams(run.id));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/user_input/);
  });
});
