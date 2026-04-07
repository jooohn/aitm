import Database from "better-sqlite3";
import { mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeConfig, resetConfigForTests } from "@/backend/infra/config";
import type { TransitionDecision } from "../agent";
import { SessionRepository } from "../sessions/session-repository";
import type { Worktree } from "../worktrees";
import { StepRunner } from "./step-runner";
import { WorkflowRunRepository } from "./workflow-run-repository";

describe("StepRunner", () => {
  let db: Database.Database;
  let sessionRepository: SessionRepository;
  let workflowRunRepository: WorkflowRunRepository;
  let originalConfigPath: string | undefined;

  beforeEach(() => {
    originalConfigPath = process.env.AITM_CONFIG_PATH;
    db = new Database(":memory:");
    sessionRepository = new SessionRepository(db);
    workflowRunRepository = new WorkflowRunRepository(db);

    sessionRepository.ensureTables();
    workflowRunRepository.ensureTables();
  });

  afterEach(() => {
    resetConfigForTests();
    if (originalConfigPath === undefined) {
      delete process.env.AITM_CONFIG_PATH;
    } else {
      process.env.AITM_CONFIG_PATH = originalConfigPath;
    }
  });

  async function writeTempConfig(content: string): Promise<string> {
    const dir = join(
      tmpdir(),
      `aitm-config-test-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(dir, { recursive: true });
    const configPath = join(dir, "config.yaml");
    await writeFile(configPath, content, "utf8");
    return configPath;
  }

  it("starts agent steps by creating a session with handoff and input context", async () => {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(`
workflows:
  my-flow:
    initial_step: plan
    steps:
      plan:
        goal: "Write a plan"
        transitions:
          - terminal: success
            when: done
`);
    await initializeConfig();
    const createSession = vi.fn().mockResolvedValue(undefined);
    const completeStepExecution = vi.fn();
    const findWorktree = vi.fn().mockResolvedValue({
      branch: "feat/test",
      path: "/tmp/worktree",
      is_main: false,
      is_bare: false,
      head: "abc1234",
    } satisfies Worktree);

    const stepRunner = new StepRunner(
      workflowRunRepository,
      { createSession } as never,
      { findWorktree } as never,
      { execute: vi.fn() } as never,
    );
    stepRunner.setStepCompletionHandler(completeStepExecution);

    workflowRunRepository.insertWorkflowRun({
      id: "run-1",
      repository_path: "/tmp/repo",
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
      initial_step: "plan",
      inputs_json: JSON.stringify({ ticket: "ABC-123" }),
      now: "2026-04-07T00:00:00.000Z",
    });

    await stepRunner.startStepExecution({
      workflowRunId: "run-1",
      stepName: "plan",
      repositoryPath: "/tmp/repo",
      worktreeBranch: "feat/test",
      workflowName: "my-flow",
      inputs: { ticket: "ABC-123" },
      previousExecutions: [
        {
          step: "plan",
          handoff_summary: "Drafted the plan",
          log_file_path: "/tmp/plan.log",
        },
      ],
    });

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        repository_path: "/tmp/repo",
        worktree_branch: "feat/test",
        goal: expect.stringContaining("Drafted the plan"),
      }),
    );
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: expect.not.stringContaining("<inputs>"),
      }),
    );
    expect(completeStepExecution).not.toHaveBeenCalled();
  });

  it("completes command steps via the bound completion handler", async () => {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(`
workflows:
  command-flow:
    initial_step: cleanup
    steps:
      cleanup:
        type: command
        command: "echo cleanup"
        transitions:
          - step: next
            when: succeeded
      next:
        goal: "Next"
        transitions:
          - terminal: success
            when: done
`);
    await initializeConfig();
    const completeStepExecution = vi.fn();
    const findWorktree = vi.fn().mockResolvedValue({
      branch: "feat/test",
      path: "/tmp/worktree",
      is_main: false,
      is_bare: false,
      head: "abc1234",
    } satisfies Worktree);
    const execute = vi.fn().mockResolvedValue({
      outcome: "succeeded",
      commandOutput: "command output",
    });

    const stepRunner = new StepRunner(
      workflowRunRepository,
      { createSession: vi.fn() } as never,
      { findWorktree } as never,
      { execute } as never,
    );
    stepRunner.setStepCompletionHandler(completeStepExecution);

    workflowRunRepository.insertWorkflowRun({
      id: "run-1",
      repository_path: "/tmp/repo",
      worktree_branch: "feat/test",
      workflow_name: "command-flow",
      initial_step: "cleanup",
      inputs_json: null,
      now: "2026-04-07T00:00:00.000Z",
    });

    const execution = await stepRunner.startStepExecution({
      workflowRunId: "run-1",
      stepName: "cleanup",
      repositoryPath: "/tmp/repo",
      worktreeBranch: "feat/test",
      workflowName: "command-flow",
      previousExecutions: [],
    });

    expect(execute).toHaveBeenCalledWith("echo cleanup", {
      cwd: "/tmp/worktree",
    });
    expect(completeStepExecution).toHaveBeenCalledWith(execution.id, {
      transition: "next",
      reason: "Command succeeded",
      handoff_summary: "command output",
    } satisfies TransitionDecision);
  });

  it("marks missing-worktree executions as failed through the completion handler", async () => {
    process.env.AITM_CONFIG_PATH = await writeTempConfig(`
workflows:
  my-flow:
    initial_step: plan
    steps:
      plan:
        goal: "Write a plan"
        transitions:
          - terminal: success
            when: done
`);
    await initializeConfig();
    const completeStepExecution = vi.fn();
    const stepRunner = new StepRunner(
      workflowRunRepository,
      { createSession: vi.fn() } as never,
      { findWorktree: vi.fn().mockResolvedValue(undefined) } as never,
      { execute: vi.fn() } as never,
    );
    stepRunner.setStepCompletionHandler(completeStepExecution);

    workflowRunRepository.insertWorkflowRun({
      id: "run-1",
      repository_path: "/tmp/repo",
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
      initial_step: "plan",
      inputs_json: null,
      now: "2026-04-07T00:00:00.000Z",
    });

    const execution = await stepRunner.startStepExecution({
      workflowRunId: "run-1",
      stepName: "plan",
      repositoryPath: "/tmp/repo",
      worktreeBranch: "feat/test",
      workflowName: "my-flow",
      previousExecutions: [],
    });

    expect(execution.id).toBeTypeOf("string");
    expect(completeStepExecution).toHaveBeenCalledWith(execution.id, null);
  });
});
