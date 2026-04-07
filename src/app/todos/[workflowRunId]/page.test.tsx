// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRunDetail } from "@/lib/utils/api";

const mockFetchWorkflowRun = vi.fn();
const mockReplace = vi.fn();
let mockWorkflowRunId = "run-1";

vi.mock("next/navigation", () => ({
  useParams: () => ({ workflowRunId: mockWorkflowRunId }),
  useRouter: () => ({ replace: mockReplace }),
  notFound: () => {
    throw new Error("notFound");
  },
}));

vi.mock("@/lib/utils/api", async () => {
  const actual = await vi.importActual("@/lib/utils/api");
  return {
    ...actual,
    fetchWorkflowRun: (...args: unknown[]) => mockFetchWorkflowRun(...args),
  };
});

vi.mock("@/lib/hooks/useNotificationStream", () => ({
  useNotificationStream: () => {},
}));

vi.mock(
  "@/app/repositories/[organization]/[name]/workflow-runs/[id]/WorkflowRunDetail",
  () => ({
    default: ({ run }: { run: { workflow_name: string } }) => (
      <div>{run.workflow_name}</div>
    ),
  }),
);

import TodoDetailRoute from "./page";

function makeRunDetail(
  overrides: Partial<WorkflowRunDetail> = {},
): WorkflowRunDetail {
  return {
    id: "run-1",
    repository_path: "/tmp/repo",
    worktree_branch: "feat/test",
    workflow_name: "build",
    current_step: "implement",
    status: "running",
    inputs: null,
    metadata: null,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    step_executions: [],
    ...overrides,
  };
}

beforeEach(() => {
  mockWorkflowRunId = "run-1";
  mockFetchWorkflowRun.mockReset();
  mockReplace.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("/todos/[workflowRunId] page", () => {
  it("auto-opens the session drawer when run is awaiting with a session", async () => {
    mockFetchWorkflowRun.mockResolvedValue(
      makeRunDetail({
        status: "awaiting",
        step_executions: [
          {
            id: "exec-1",
            workflow_run_id: "run-1",
            step: "implement",
            step_type: "agent",
            status: "awaiting",
            command_output: null,
            session_id: "session-abc",
            session_status: "paused",
            transition_decision: null,
            handoff_summary: null,
            created_at: "2026-04-01T00:00:00Z",
            completed_at: null,
          },
        ],
      }),
    );

    render(<TodoDetailRoute />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        "/todos/run-1/sessions/session-abc",
      );
    });
  });

  it("does not redirect when run is not in awaiting status", async () => {
    mockFetchWorkflowRun.mockResolvedValue(
      makeRunDetail({
        status: "running",
        step_executions: [
          {
            id: "exec-1",
            workflow_run_id: "run-1",
            step: "implement",
            step_type: "agent",
            status: "running",
            command_output: null,
            session_id: "session-abc",
            session_status: "active",
            transition_decision: null,
            handoff_summary: null,
            created_at: "2026-04-01T00:00:00Z",
            completed_at: null,
          },
        ],
      }),
    );

    render(<TodoDetailRoute />);

    await waitFor(() => {
      expect(screen.getByText("build")).toBeInTheDocument();
    });

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("does not redirect when no step execution has a session_id", async () => {
    mockFetchWorkflowRun.mockResolvedValue(
      makeRunDetail({
        status: "awaiting",
        step_executions: [
          {
            id: "exec-1",
            workflow_run_id: "run-1",
            step: "approve",
            step_type: "manual-approval",
            status: "awaiting",
            command_output: null,
            session_id: null,
            session_status: null,
            transition_decision: null,
            handoff_summary: null,
            created_at: "2026-04-01T00:00:00Z",
            completed_at: null,
          },
        ],
      }),
    );

    render(<TodoDetailRoute />);

    await waitFor(() => {
      expect(screen.getByText("build")).toBeInTheDocument();
    });

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("resets checked state when workflowRunId changes, preventing flash of WorkflowRunPage", async () => {
    // First render with a non-awaiting run — WorkflowRunPage should appear.
    // Use mockResolvedValue (not Once) to handle React strict mode double-firing effects.
    const run1 = makeRunDetail({
      id: "run-1",
      status: "running",
      step_executions: [],
    });
    mockFetchWorkflowRun.mockResolvedValue(run1);

    const { rerender } = render(<TodoDetailRoute />);

    await waitFor(() => {
      expect(screen.getByText("build")).toBeInTheDocument();
    });

    // Switch to an awaiting run. Reset mock first, then use mockResolvedValue.
    const run2 = makeRunDetail({
      id: "run-2",
      status: "awaiting",
      step_executions: [
        {
          id: "exec-2",
          workflow_run_id: "run-2",
          step: "implement",
          step_type: "agent",
          status: "awaiting",
          command_output: null,
          session_id: "session-xyz",
          session_status: "paused",
          transition_decision: null,
          handoff_summary: null,
          created_at: "2026-04-01T00:00:00Z",
          completed_at: null,
        },
      ],
    });
    mockFetchWorkflowRun.mockReset();
    mockFetchWorkflowRun.mockResolvedValue(run2);
    mockWorkflowRunId = "run-2";

    rerender(<TodoDetailRoute />);

    // checked resets synchronously during render (not in useEffect),
    // so WorkflowRunPage should NOT be visible during the transition
    expect(screen.queryByText("build")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        "/todos/run-2/sessions/session-xyz",
      );
    });
  });

  it("cancels stale fetch callback when workflowRunId changes quickly", async () => {
    // Simulate a slow fetch for run-1 that resolves AFTER we navigate to run-2.
    // The stale run-1 callback should NOT call setChecked(true).
    let resolveRun1!: (value: WorkflowRunDetail) => void;
    const run1Promise = new Promise<WorkflowRunDetail>((resolve) => {
      resolveRun1 = resolve;
    });

    mockFetchWorkflowRun.mockReturnValue(run1Promise);

    const { rerender } = render(<TodoDetailRoute />);

    // Navigate to run-2 before run-1's fetch completes.
    const run2 = makeRunDetail({
      id: "run-2",
      status: "awaiting",
      step_executions: [
        {
          id: "exec-2",
          workflow_run_id: "run-2",
          step: "implement",
          step_type: "agent",
          status: "awaiting",
          command_output: null,
          session_id: "session-xyz",
          session_status: "paused",
          transition_decision: null,
          handoff_summary: null,
          created_at: "2026-04-01T00:00:00Z",
          completed_at: null,
        },
      ],
    });
    mockFetchWorkflowRun.mockReset();
    mockFetchWorkflowRun.mockResolvedValue(run2);
    mockWorkflowRunId = "run-2";
    rerender(<TodoDetailRoute />);

    // Now resolve the stale run-1 fetch — it should be ignored (cancelled).
    resolveRun1(
      makeRunDetail({ id: "run-1", status: "running", step_executions: [] }),
    );

    // The component should redirect to run-2's session, not show WorkflowRunPage.
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        "/todos/run-2/sessions/session-xyz",
      );
    });

    // WorkflowRunPage should NOT be visible — the stale run-1 callback must not set checked=true.
    expect(screen.queryByText("build")).not.toBeInTheDocument();
  });
});
