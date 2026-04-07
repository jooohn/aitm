// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchWorkflowRun = vi.fn();

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));

vi.mock(
  "@/app/repositories/[organization]/[name]/workflow-runs/[id]/WorkflowRunDetail",
  () => ({
    default: ({ run }: { run: { workflow_name: string } }) => (
      <div>{run.workflow_name}</div>
    ),
  }),
);

vi.mock("@/lib/utils/api", async () => {
  const actual = await vi.importActual("@/lib/utils/api");
  return {
    ...actual,
    fetchWorkflowRun: (...args: unknown[]) => mockFetchWorkflowRun(...args),
  };
});

let notificationCallback: (() => void) | null = null;
vi.mock("@/lib/hooks/useNotificationStream", () => ({
  useNotificationStream: (cb: () => void) => {
    notificationCallback = cb;
  },
}));

import WorkflowRunPage from "./WorkflowRunPage";

beforeEach(() => {
  mockFetchWorkflowRun.mockResolvedValue({
    id: "run-1",
    repository_path: "/tmp/repo",
    worktree_branch: "feat/test",
    workflow_name: "build",
    current_step: "plan",
    status: "running",
    inputs: null,
    metadata: null,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    step_executions: [],
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorkflowRunPage", () => {
  it("re-fetches the workflow run when notification stream fires", async () => {
    render(<WorkflowRunPage workflowRunId="run-1" />);

    await screen.findByText("build");

    const initialCalls = mockFetchWorkflowRun.mock.calls.length;

    act(() => {
      notificationCallback?.();
    });

    await waitFor(() => {
      expect(mockFetchWorkflowRun.mock.calls.length).toBeGreaterThan(
        initialCalls,
      );
    });
  });
});
