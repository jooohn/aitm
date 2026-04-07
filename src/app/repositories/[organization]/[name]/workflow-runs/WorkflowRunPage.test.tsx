// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchWorkflowRun = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/repositories/org/repo/workflow-runs/run-1",
  useRouter: () => ({ push: vi.fn() }),
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

import { SWRTestProvider } from "@/test-swr-provider";
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
  it("fetches and renders the workflow run", async () => {
    render(
      <SWRTestProvider>
        <WorkflowRunPage workflowRunId="run-1" />
      </SWRTestProvider>,
    );

    await screen.findByText("build");
    expect(mockFetchWorkflowRun).toHaveBeenCalledWith("run-1");
  });
});
