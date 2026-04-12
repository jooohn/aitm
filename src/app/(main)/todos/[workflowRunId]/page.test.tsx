// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRunDetail } from "@/lib/utils/api";

const mockFetchWorkflowRun = vi.fn();
let mockWorkflowRunId = "run-1";

vi.mock("next/navigation", () => ({
  useParams: () => ({ workflowRunId: mockWorkflowRunId }),
  usePathname: () => `/todos/${mockWorkflowRunId}`,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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
  "@/app/(main)/repositories/[organization]/[name]/workflow-runs/[id]/WorkflowRunDetail",
  () => ({
    default: ({ run }: { run: { workflow_name: string } }) => (
      <div>{run.workflow_name}</div>
    ),
  }),
);

import { SWRTestProvider } from "@/test-swr-provider";
import TodoDetailRoute from "./page";

function makeRunDetail(
  overrides: Partial<WorkflowRunDetail> = {},
): WorkflowRunDetail {
  return {
    id: "run-1",
    organization: "tmp",
    name: "repo",
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
});

afterEach(() => {
  cleanup();
});

describe("/todos/[workflowRunId] page", () => {
  it("renders the workflow run detail", async () => {
    mockFetchWorkflowRun.mockResolvedValue(
      makeRunDetail({ status: "running" }),
    );

    render(
      <SWRTestProvider>
        <TodoDetailRoute />
      </SWRTestProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("build")).toBeInTheDocument();
    });
  });

  it("renders the workflow run detail even when run is awaiting", async () => {
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
            output_file_path: null,
            session_id: "session-abc",
            session_status: "awaiting_input",
            command_execution_id: null,
            transition_decision: null,
            handoff_summary: null,
            created_at: "2026-04-01T00:00:00Z",
            completed_at: null,
          },
        ],
      }),
    );

    render(
      <SWRTestProvider>
        <TodoDetailRoute />
      </SWRTestProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("build")).toBeInTheDocument();
    });
  });
});
