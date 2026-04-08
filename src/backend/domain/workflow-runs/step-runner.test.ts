import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig, WorkflowDefinition } from "@/backend/infra/config";
import type { TransitionDecision } from "../agent";
import { SessionRepository } from "../sessions/session-repository";
import type { Worktree } from "../worktrees";
import { StepRunner } from "./step-runner";
import { WorkflowRunRepository } from "./workflow-run-repository";

const DEFAULT_AGENT_CONFIG: AgentConfig = { provider: "claude" };

describe("StepRunner", () => {
  let db: Database.Database;
  let sessionRepository: SessionRepository;
  let workflowRunRepository: WorkflowRunRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    sessionRepository = new SessionRepository(db);
    workflowRunRepository = new WorkflowRunRepository(db);

    sessionRepository.ensureTables();
    workflowRunRepository.ensureTables();
  });

  it("starts agent steps by creating a session with handoff and input context", async () => {
    const workflows: Record<string, WorkflowDefinition> = {
      "my-flow": {
        initial_step: "plan",
        artifacts: [
          {
            name: "plan",
            path: "plan.md",
            description: "Shared plan for the run",
          },
        ],
        steps: {
          plan: {
            type: "agent",
            goal: "Write a plan",
            transitions: [{ terminal: "success", when: "done" }],
          },
        },
      },
    };
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
      workflows,
      DEFAULT_AGENT_CONFIG,
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
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: expect.stringContaining("<artifacts>"),
      }),
    );
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: expect.stringContaining(
          "/tmp/worktree/.aitm/runs/run-1/artifacts/plan.md",
        ),
      }),
    );
    expect(completeStepExecution).not.toHaveBeenCalled();
  });

  it("completes command steps via the bound completion handler", async () => {
    const workflows: Record<string, WorkflowDefinition> = {
      "command-flow": {
        initial_step: "cleanup",
        steps: {
          cleanup: {
            type: "command",
            command: "echo cleanup",
            transitions: [{ step: "next", when: "succeeded" }],
          },
          next: {
            type: "agent",
            goal: "Next",
            transitions: [{ terminal: "success", when: "done" }],
          },
        },
      },
    };
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
      workflows,
      DEFAULT_AGENT_CONFIG,
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
    const workflows: Record<string, WorkflowDefinition> = {
      "my-flow": {
        initial_step: "plan",
        steps: {
          plan: {
            type: "agent",
            goal: "Write a plan",
            transitions: [{ terminal: "success", when: "done" }],
          },
        },
      },
    };
    const completeStepExecution = vi.fn();
    const stepRunner = new StepRunner(
      workflowRunRepository,
      { createSession: vi.fn() } as never,
      { findWorktree: vi.fn().mockResolvedValue(undefined) } as never,
      { execute: vi.fn() } as never,
      workflows,
      DEFAULT_AGENT_CONFIG,
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
