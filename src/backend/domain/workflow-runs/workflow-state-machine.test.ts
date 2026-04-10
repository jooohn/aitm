import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDefinition } from "@/backend/infra/config";
import type { TransitionDecision } from "../agent";
import { SessionRepository } from "../sessions/session-repository";
import type { StartStepExecutionInput } from "./step-runner";
import { WorkflowRunRepository } from "./workflow-run-repository";
import { WorkflowStateMachine } from "./workflow-state-machine";

const TWO_STEP_WORKFLOWS: Record<string, WorkflowDefinition> = {
  "my-flow": {
    initial_step: "plan",
    steps: {
      plan: {
        type: "agent",
        goal: "Write a plan",
        transitions: [{ step: "implement", when: "ready" }],
      },
      implement: {
        type: "agent",
        goal: "Write code",
        transitions: [{ terminal: "success", when: "done" }],
      },
    },
  },
};

const SINGLE_STEP_WORKFLOWS: Record<string, WorkflowDefinition> = {
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

const APPROVAL_WORKFLOWS: Record<string, WorkflowDefinition> = {
  "approval-flow": {
    initial_step: "plan",
    steps: {
      plan: {
        type: "agent",
        goal: "Write a plan",
        transitions: [{ step: "review", when: "ready" }],
      },
      review: {
        type: "manual-approval",
        transitions: [
          { terminal: "success", when: "approved" },
          { terminal: "failure", when: "rejected" },
        ],
      },
    },
  },
};

const APPROVAL_ONLY_WORKFLOWS: Record<string, WorkflowDefinition> = {
  "approval-flow": {
    initial_step: "review",
    steps: {
      review: {
        type: "manual-approval",
        transitions: [
          { terminal: "success", when: "approved" },
          { terminal: "failure", when: "rejected" },
        ],
      },
    },
  },
};

const CHAINED_APPROVAL_WORKFLOWS: Record<string, WorkflowDefinition> = {
  "approval-flow": {
    initial_step: "review",
    steps: {
      review: {
        type: "manual-approval",
        transitions: [
          { step: "signoff", when: "approved" },
          { terminal: "failure", when: "rejected" },
        ],
      },
      signoff: {
        type: "manual-approval",
        transitions: [
          { terminal: "success", when: "approved" },
          { terminal: "failure", when: "rejected" },
        ],
      },
    },
  },
};

describe("WorkflowStateMachine", () => {
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

  it("advances persisted workflow state and starts the next step", async () => {
    workflowRunRepository.insertWorkflowRun({
      id: "run-1",
      repository_path: "/tmp/repo",
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
      initial_step: "plan",
      inputs_json: JSON.stringify({ ticket: "ABC-123" }),
      now: "2026-04-07T00:00:00.000Z",
    });
    workflowRunRepository.insertStepExecution({
      id: "exec-1",
      workflowRunId: "run-1",
      stepName: "plan",
      stepType: "agent",
      now: "2026-04-07T00:00:00.000Z",
    });

    const startStepExecution = vi.fn().mockResolvedValue({
      id: "exec-2",
      workflow_run_id: "run-1",
      step: "implement",
      step_type: "agent",
      status: "running",
      output_file_path: null,
      session_id: null,
      session_status: null,
      transition_decision: null,
      handoff_summary: null,
      created_at: "2026-04-07T00:00:01.000Z",
      completed_at: null,
    });
    const stateMachine = new WorkflowStateMachine(
      workflowRunRepository,
      { startStepExecution } as never,
      TWO_STEP_WORKFLOWS,
    );

    await stateMachine.completeStepExecution("exec-1", {
      transition: "implement",
      reason: "Plan is done",
      handoff_summary: "Wrote PLAN.md",
      metadata: { pr_url: "https://github.com/org/repo/pull/42" },
    });

    const run = workflowRunRepository.getWorkflowRunById("run-1");
    const execution = workflowRunRepository.getStepExecution("exec-1");

    expect(run?.status).toBe("running");
    expect(run?.current_step).toBe("implement");
    expect(run?.metadata).toEqual({
      pr_url: "https://github.com/org/repo/pull/42",
    });
    expect(execution?.status).toBe("success");
    expect(startStepExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: "run-1",
        stepName: "implement",
        inputs: { ticket: "ABC-123" },
        previousExecutions: [
          {
            step: "plan",
            handoff_summary: "Wrote PLAN.md",
            log_file_path: null,
            output_file_path: null,
          },
        ],
      }),
    );
  });

  it("terminates the workflow when the transition target does not exist", async () => {
    workflowRunRepository.insertWorkflowRun({
      id: "run-1",
      repository_path: "/tmp/repo",
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
      initial_step: "plan",
      inputs_json: null,
      now: "2026-04-07T00:00:00.000Z",
    });
    workflowRunRepository.insertStepExecution({
      id: "exec-1",
      workflowRunId: "run-1",
      stepName: "plan",
      stepType: "agent",
      now: "2026-04-07T00:00:00.000Z",
    });

    const stateMachine = new WorkflowStateMachine(
      workflowRunRepository,
      { startStepExecution: vi.fn() } as never,
      TWO_STEP_WORKFLOWS,
    );

    await stateMachine.completeStepExecution("exec-1", {
      transition: "missing-step",
      reason: "bad output",
      handoff_summary: "",
    });

    const run = workflowRunRepository.getWorkflowRunById("run-1");
    expect(run?.status).toBe("failure");
    expect(run?.current_step).toBe("plan");
  });

  it("marks the workflow as awaiting when the next persisted step is manual approval", async () => {
    workflowRunRepository.insertWorkflowRun({
      id: "run-1",
      repository_path: "/tmp/repo",
      worktree_branch: "feat/test",
      workflow_name: "approval-flow",
      initial_step: "plan",
      inputs_json: null,
      now: "2026-04-07T00:00:00.000Z",
    });
    workflowRunRepository.insertStepExecution({
      id: "exec-1",
      workflowRunId: "run-1",
      stepName: "plan",
      stepType: "agent",
      now: "2026-04-07T00:00:00.000Z",
    });

    const stateMachine = new WorkflowStateMachine(
      workflowRunRepository,
      {
        startStepExecution: async (input) => {
          workflowRunRepository.insertStepExecution({
            id: "exec-2",
            workflowRunId: input.workflowRunId,
            stepName: input.stepName,
            stepType: "manual-approval",
            now: "2026-04-07T00:00:01.000Z",
          });
          workflowRunRepository.setStepExecutionStatus("exec-2", "awaiting");
          return workflowRunRepository.getStepExecution("exec-2")!;
        },
      },
      APPROVAL_WORKFLOWS,
    );

    await stateMachine.completeStepExecution("exec-1", {
      transition: "review",
      reason: "Plan is ready",
      handoff_summary: "Plan complete",
    });

    const run = workflowRunRepository.getWorkflowRunById("run-1");
    expect(run?.current_step).toBe("review");
    expect(run?.status).toBe("awaiting");
  });

  it("updates persisted run status from session lifecycle events without inline service logic", async () => {
    workflowRunRepository.insertWorkflowRun({
      id: "run-1",
      repository_path: "/tmp/repo",
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
      initial_step: "plan",
      inputs_json: null,
      now: "2026-04-07T00:00:00.000Z",
    });
    workflowRunRepository.insertStepExecution({
      id: "exec-1",
      workflowRunId: "run-1",
      stepName: "plan",
      stepType: "agent",
      now: "2026-04-07T00:00:00.000Z",
    });
    sessionRepository.insertSession({
      id: "session-1",
      repository_path: "/tmp/repo",
      worktree_branch: "feat/test",
      goal: "Goal",
      transitions: "[]",
      agent_config: '{"provider":"codex"}',
      log_file_path: "/tmp/session.log",
      step_execution_id: "exec-1",
      metadata_fields: null,
      now: "2026-04-07T00:00:00.000Z",
    });

    const completeStepExecution = vi.fn().mockResolvedValue(undefined);
    const stateMachine = new WorkflowStateMachine(
      workflowRunRepository,
      { startStepExecution: vi.fn() } as never,
      SINGLE_STEP_WORKFLOWS,
    );
    vi.spyOn(stateMachine, "completeStepExecution").mockImplementation(
      completeStepExecution,
    );

    await stateMachine.handleSessionStatusChanged({
      workflowRunId: "run-1",
      branchName: "feat/test",
      repositoryOrganization: "tmp",
      repositoryName: "repo",
      sessionId: "session-1",
      status: "awaiting_input",
    });
    expect(workflowRunRepository.getWorkflowRunById("run-1")?.status).toBe(
      "awaiting",
    );
    expect(workflowRunRepository.getStepExecution("exec-1")?.status).toBe(
      "awaiting",
    );

    await stateMachine.handleSessionStatusChanged({
      workflowRunId: "run-1",
      branchName: "feat/test",
      repositoryOrganization: "tmp",
      repositoryName: "repo",
      sessionId: "session-1",
      status: "success",
      decision: {
        transition: "success",
        reason: "done",
        handoff_summary: "done",
      } satisfies TransitionDecision,
    });
    expect(completeStepExecution).toHaveBeenCalledWith("exec-1", {
      transition: "success",
      reason: "done",
      handoff_summary: "done",
    });
  });

  it("marks the workflow as awaiting when rerunning a failed manual-approval step", async () => {
    workflowRunRepository.insertWorkflowRun({
      id: "run-1",
      repository_path: "/tmp/repo",
      worktree_branch: "feat/test",
      workflow_name: "approval-flow",
      initial_step: "review",
      inputs_json: null,
      now: "2026-04-07T00:00:00.000Z",
    });
    workflowRunRepository.insertStepExecution({
      id: "exec-1",
      workflowRunId: "run-1",
      stepName: "review",
      stepType: "manual-approval",
      now: "2026-04-07T00:00:00.000Z",
    });
    workflowRunRepository.setStepExecutionStatus("exec-1", "awaiting");
    workflowRunRepository.completeStepExecution(
      "exec-1",
      JSON.stringify({
        transition: "failure",
        reason: "rejected",
        handoff_summary: "Needs changes",
      }),
      "Needs changes",
      "2026-04-07T00:00:01.000Z",
      "failure",
    );
    workflowRunRepository.terminateWorkflowRun(
      "run-1",
      "failure",
      "2026-04-07T00:00:01.000Z",
    );

    const stateMachine = new WorkflowStateMachine(
      workflowRunRepository,
      {
        startStepExecution: async (input) => {
          workflowRunRepository.insertStepExecution({
            id: "exec-2",
            workflowRunId: input.workflowRunId,
            stepName: input.stepName,
            stepType: "manual-approval",
            now: "2026-04-07T00:00:02.000Z",
          });
          workflowRunRepository.setStepExecutionStatus("exec-2", "awaiting");
          return workflowRunRepository.getStepExecution("exec-2")!;
        },
      } as never,
      APPROVAL_ONLY_WORKFLOWS,
    );

    await stateMachine.rerunWorkflowRunFromFailedState("run-1");

    const run = workflowRunRepository.getWorkflowRunById("run-1");
    expect(run?.current_step).toBe("review");
    expect(run?.status).toBe("awaiting");
  });

  it("keeps the workflow awaiting when manual approval resolves into another manual-approval step", async () => {
    workflowRunRepository.insertWorkflowRun({
      id: "run-1",
      repository_path: "/tmp/repo",
      worktree_branch: "feat/test",
      workflow_name: "approval-flow",
      initial_step: "review",
      inputs_json: null,
      now: "2026-04-07T00:00:00.000Z",
    });
    workflowRunRepository.insertStepExecution({
      id: "exec-1",
      workflowRunId: "run-1",
      stepName: "review",
      stepType: "manual-approval",
      now: "2026-04-07T00:00:00.000Z",
    });
    workflowRunRepository.setStepExecutionStatus("exec-1", "awaiting");
    workflowRunRepository.setWorkflowRunAwaiting(
      "run-1",
      "2026-04-07T00:00:00.000Z",
    );

    const stateMachine = new WorkflowStateMachine(
      workflowRunRepository,
      {
        startStepExecution: async (input: StartStepExecutionInput) => {
          workflowRunRepository.insertStepExecution({
            id: "exec-2",
            workflowRunId: input.workflowRunId,
            stepName: input.stepName,
            stepType: "manual-approval",
            now: "2026-04-07T00:00:01.000Z",
          });
          workflowRunRepository.setStepExecutionStatus("exec-2", "awaiting");
          return workflowRunRepository.getStepExecution("exec-2")!;
        },
      },
      CHAINED_APPROVAL_WORKFLOWS,
    );

    const updatedRun = await stateMachine.resolveManualApproval(
      "run-1",
      "approved",
      "Ready for signoff",
    );

    const activeExecution =
      workflowRunRepository.getActiveStepExecution("run-1");
    expect(updatedRun.current_step).toBe("signoff");
    expect(updatedRun.status).toBe("awaiting");
    expect(activeExecution?.step).toBe("signoff");
    expect(activeExecution?.status).toBe("awaiting");
  });
});
