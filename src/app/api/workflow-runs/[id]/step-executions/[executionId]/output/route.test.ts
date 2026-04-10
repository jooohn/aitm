import { mkdir, readFile } from "fs/promises";
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

function makeParams(
  id: string,
  executionId: string,
): { params: Promise<{ id: string; executionId: string }> } {
  return { params: Promise.resolve({ id, executionId }) };
}

let configFile: string;
let worktreePath: string;

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
          - terminal: success
            when: "done"
`,
  );
  container.initializeContainer();

  db.prepare("DELETE FROM sessions").run();
  db.prepare("DELETE FROM step_executions").run();
  db.prepare("DELETE FROM workflow_runs").run();

  worktreePath = await makeFakeGitRepo();

  vi.spyOn(container.agentService, "startAgent").mockResolvedValue(undefined);
  vi.spyOn(container.worktreeService, "listWorktrees").mockImplementation(
    async () => [
      {
        branch: "feat/test",
        path: worktreePath,
        is_main: false,
        is_bare: false,
        head: "HEAD",
      },
    ],
  );
});

describe("GET /api/workflow-runs/:id/step-executions/:executionId/output", () => {
  it("serves command output for legacy executions after backfilling to a run-scoped file", async () => {
    const repoPath = await makeFakeGitRepo();
    db.exec("ALTER TABLE step_executions ADD COLUMN command_output TEXT");
    db.prepare(
      `INSERT INTO workflow_runs
       (id, repository_path, worktree_branch, workflow_name, current_step, status, inputs, metadata, step_count_offset, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'success', NULL, NULL, 0, ?, ?)`,
    ).run(
      "run-legacy",
      repoPath,
      "feat/test",
      "my-flow",
      "2026-04-10T00:00:00.000Z",
      "2026-04-10T00:00:01.000Z",
    );
    db.prepare(
      `INSERT INTO step_executions
       (id, workflow_run_id, step, step_type, status, output_file_path, transition_decision, handoff_summary, created_at, completed_at, command_output)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    ).run(
      "exec-legacy",
      "run-legacy",
      "lint",
      "command",
      "success",
      JSON.stringify({
        transition: "success",
        reason: "Command succeeded",
        handoff_summary: "stdout line\nstderr line",
      }),
      "stdout line\nstderr line",
      "2026-04-10T00:00:00.000Z",
      "2026-04-10T00:00:01.000Z",
      "stdout line\nstderr line",
    );

    const res = await GET(
      new NextRequest(
        "http://localhost/api/workflow-runs/run-legacy/step-executions/exec-legacy/output",
      ),
      makeParams("run-legacy", "exec-legacy"),
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("stdout line\nstderr line");
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");

    const execution = db
      .prepare(
        "SELECT output_file_path, handoff_summary FROM step_executions WHERE id = ?",
      )
      .get("exec-legacy") as {
      output_file_path: string | null;
      handoff_summary: string | null;
    };
    expect(execution.output_file_path).toMatch(
      /\/\.aitm\/runs\/run-legacy\/command-output\/exec-legacy\.log$/,
    );
    expect(execution.handoff_summary).toBe(
      `Command succeeded. Detailed output: ${execution.output_file_path}`,
    );
    await expect(
      readFile(execution.output_file_path as string, "utf8"),
    ).resolves.toBe("stdout line\nstderr line");
  });
});
