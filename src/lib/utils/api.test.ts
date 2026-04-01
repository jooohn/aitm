import { describe, expect, it } from "vitest";
import { canStopWorkflowRun, type WorkflowRunDetail } from "./api";

function makeRun(
  overrides: Partial<WorkflowRunDetail> = {},
): WorkflowRunDetail {
  return {
    id: "run-1",
    repository_path: "/tmp/repo",
    worktree_branch: "feat/test",
    workflow_name: "my-flow",
    current_state: "plan",
    status: "running",
    inputs: null,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
    state_executions: [],
    ...overrides,
  };
}

describe("canStopWorkflowRun", () => {
  it("returns true for a running workflow with an active session-backed execution", () => {
    const run = makeRun({
      state_executions: [
        {
          id: "exec-1",
          workflow_run_id: "run-1",
          state: "plan",
          command_output: null,
          session_id: "session-1",
          session_status: "RUNNING",
          transition_decision: null,
          handoff_summary: null,
          created_at: "2026-04-01T00:00:00.000Z",
          completed_at: null,
        },
      ],
    });

    expect(canStopWorkflowRun(run)).toBe(true);
  });

  it("returns false for a running workflow whose active execution has no session", () => {
    const run = makeRun({
      state_executions: [
        {
          id: "exec-1",
          workflow_run_id: "run-1",
          state: "plan",
          command_output: null,
          session_id: null,
          session_status: null,
          transition_decision: null,
          handoff_summary: null,
          created_at: "2026-04-01T00:00:00.000Z",
          completed_at: null,
        },
      ],
    });

    expect(canStopWorkflowRun(run)).toBe(false);
  });

  it("returns false for terminal workflow runs", () => {
    const run = makeRun({
      status: "failure",
      current_state: null,
      state_executions: [
        {
          id: "exec-1",
          workflow_run_id: "run-1",
          state: "plan",
          command_output: null,
          session_id: "session-1",
          session_status: "FAILED",
          transition_decision: null,
          handoff_summary: null,
          created_at: "2026-04-01T00:00:00.000Z",
          completed_at: "2026-04-01T00:00:01.000Z",
        },
      ],
    });

    expect(canStopWorkflowRun(run)).toBe(false);
  });
});
