import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canStopWorkflowRun,
  fetchSessionsByStatus,
  type WorkflowRunDetail,
} from "./api";

function makeRun(
  overrides: Partial<WorkflowRunDetail> = {},
): WorkflowRunDetail {
  return {
    id: "run-1",
    repository_path: "/tmp/repo",
    worktree_branch: "feat/test",
    workflow_name: "my-flow",
    current_step: "plan",
    status: "running",
    inputs: null,
    metadata: null,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
    step_executions: [],
    ...overrides,
  };
}

describe("canStopWorkflowRun", () => {
  it("returns true for a running workflow with an active session-backed execution", () => {
    const run = makeRun({
      step_executions: [
        {
          id: "exec-1",
          workflow_run_id: "run-1",
          step: "plan",
          command_output: null,
          session_id: "session-1",
          session_status: "running",
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
      step_executions: [
        {
          id: "exec-1",
          workflow_run_id: "run-1",
          step: "plan",
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
      current_step: null,
      step_executions: [
        {
          id: "exec-1",
          workflow_run_id: "run-1",
          step: "plan",
          command_output: null,
          session_id: "session-1",
          session_status: "failure",
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchSessionsByStatus", () => {
  it("requests sessions filtered by status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchSessionsByStatus("awaiting_input");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions?status=awaiting_input",
      { cache: "no-store" },
    );
  });
});
