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

const createWorkflowRun =
  workflowRunService.createWorkflowRun.bind(workflowRunService);

import { db } from "@/backend/infra/db";
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
  const dir = join(
    tmpdir(),
    `aitm-config-test-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  configFile = join(dir, "config.yaml");
  process.env.AITM_CONFIG_PATH = configFile;
  await writeFile(
    configFile,
    `
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
`,
  );

  db.prepare("DELETE FROM sessions").run();
  db.prepare("DELETE FROM state_executions").run();
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

afterEach(() => {
  delete process.env.AITM_CONFIG_PATH;
});

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/workflow-runs/:id", () => {
  it("returns 200 with the workflow run and its state executions", async () => {
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
    expect(Array.isArray(body.state_executions)).toBe(true);
    expect(body.state_executions).toHaveLength(1);
    expect(body.state_executions[0].state).toBe("plan");
  });

  it("returns 404 for unknown id", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/workflow-runs/nonexistent"),
      makeParams("nonexistent"),
    );
    expect(res.status).toBe(404);
  });
});
