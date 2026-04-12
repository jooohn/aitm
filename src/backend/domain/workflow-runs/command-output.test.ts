import { mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getContainer, initializeContainer } from "@/backend/container";
import { db } from "@/backend/infra/db";
import { setupTestConfigDir, writeTestConfig } from "@/test-config-helper";
import { getWorkflowRunCommandOutput } from "./command-output";

async function makeFakeGitRepo(): Promise<string> {
  const dir = join(
    tmpdir(),
    `aitm-command-output-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(join(dir, ".git"), { recursive: true });
  return dir;
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
  initializeContainer();

  db.prepare("DELETE FROM sessions").run();
  db.prepare("DELETE FROM step_executions").run();
  db.prepare("DELETE FROM workflow_runs").run();

  worktreePath = await makeFakeGitRepo();

  vi.spyOn(getContainer().agentService, "startAgent").mockResolvedValue(
    undefined,
  );
  vi.spyOn(getContainer().worktreeService, "listWorktrees").mockImplementation(
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

describe("getWorkflowRunCommandOutput", () => {
  it("returns the file content for a command output inside the run directory", async () => {
    db.prepare(
      `INSERT INTO workflow_runs
       (id, repository_path, worktree_branch, workflow_name, current_step, status, inputs, metadata, step_count_offset, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'success', NULL, NULL, 0, ?, ?)`,
    ).run(
      "run-1",
      worktreePath,
      "feat/test",
      "my-flow",
      "2026-04-10T00:00:00.000Z",
      "2026-04-10T00:00:01.000Z",
    );
    const outputPath = join(
      worktreePath,
      ".aitm",
      "runs",
      "run-1",
      "command-outputs",
      "exec-1.log",
    );
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, "stdout line\nstderr line", "utf8");
    db.prepare(
      `INSERT INTO step_executions
       (id, workflow_run_id, step, step_type, status, output_file_path, transition_decision, handoff_summary, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    ).run(
      "exec-1",
      "run-1",
      "lint",
      "command",
      "success",
      outputPath,
      "2026-04-10T00:00:00.000Z",
      "2026-04-10T00:00:01.000Z",
    );

    await expect(
      getWorkflowRunCommandOutput("run-1", "exec-1.log"),
    ).resolves.toEqual({
      filename: "exec-1.log",
      content: "stdout line\nstderr line",
    });
  });

  it("returns null when the matched execution points outside the workflow run directory", async () => {
    db.prepare(
      `INSERT INTO workflow_runs
       (id, repository_path, worktree_branch, workflow_name, current_step, status, inputs, metadata, step_count_offset, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'success', NULL, NULL, 0, ?, ?)`,
    ).run(
      "run-1",
      worktreePath,
      "feat/test",
      "my-flow",
      "2026-04-10T00:00:00.000Z",
      "2026-04-10T00:00:01.000Z",
    );
    const outputPath = join(tmpdir(), "outside.log");
    await writeFile(outputPath, "nope", "utf8");
    db.prepare(
      `INSERT INTO step_executions
       (id, workflow_run_id, step, step_type, status, output_file_path, transition_decision, handoff_summary, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    ).run(
      "exec-1",
      "run-1",
      "lint",
      "command",
      "success",
      outputPath,
      "2026-04-10T00:00:00.000Z",
      "2026-04-10T00:00:01.000Z",
    );

    await expect(
      getWorkflowRunCommandOutput("run-1", "outside.log"),
    ).resolves.toBeNull();
  });
});
