// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StepExecution, WorkflowRunDetail } from "@/lib/utils/api";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

let mockParams = {
  id: "run-1",
  executionId: "exec-1",
  organization: "my-org",
  name: "my-repo",
};
let mockRunData: WorkflowRunDetail | null = null;
let mockFetchError = false;

vi.mock("next/navigation", () => ({
  useParams: () => mockParams,
  notFound: () => {
    throw new Error("notFound");
  },
}));

vi.mock("@/lib/utils/api", async () => {
  const actual = await vi.importActual("@/lib/utils/api");
  return {
    ...actual,
    fetchWorkflowRun: vi.fn(async () => {
      if (mockFetchError) throw new Error("fetch failed");
      return mockRunData;
    }),
  };
});

import StepExecutionPage from "./page";

function makeExecution(
  overrides: Partial<StepExecution> & { id: string; step: string },
): StepExecution {
  return {
    workflow_run_id: "run-1",
    step_type: "agent",
    command_output: null,
    session_id: null,
    session_status: null,
    transition_decision: null,
    handoff_summary: null,
    created_at: "2024-01-01T00:00:00Z",
    completed_at: "2024-01-01T00:05:00Z",
    ...overrides,
  };
}

function makeRun(
  overrides: Partial<WorkflowRunDetail> = {},
): WorkflowRunDetail {
  return {
    id: "run-1",
    repository_path: "/tmp/repos/acme/app",
    worktree_branch: "feat/test",
    workflow_name: "my-flow",
    current_step: null,
    status: "success",
    inputs: null,
    metadata: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:05:00Z",
    step_executions: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  mockFetchError = false;
  mockRunData = null;
});

describe("StepExecutionPage", () => {
  it("renders state name and type for an agent execution", async () => {
    mockParams = {
      id: "run-1",
      executionId: "exec-1",
      organization: "my-org",
      name: "my-repo",
    };
    mockRunData = makeRun({
      step_executions: [
        makeExecution({
          id: "exec-1",
          step: "plan",
          step_type: "agent",
          session_id: "session-abc",
        }),
      ],
    });

    render(<StepExecutionPage />);
    // Wait for async fetch - state name appears as h1 heading
    expect(
      await screen.findByRole("heading", { level: 1, name: "plan" }),
    ).toBeInTheDocument();
    expect(screen.getByText("agent")).toBeInTheDocument();
  });

  it("renders a link to the session for agent-type executions", async () => {
    mockParams = {
      id: "run-1",
      executionId: "exec-1",
      organization: "my-org",
      name: "my-repo",
    };
    mockRunData = makeRun({
      step_executions: [
        makeExecution({
          id: "exec-1",
          step: "plan",
          step_type: "agent",
          session_id: "session-abc",
        }),
      ],
    });

    render(<StepExecutionPage />);
    const sessionLink = await screen.findByRole("link", {
      name: /session/i,
    });
    expect(sessionLink).toHaveAttribute(
      "href",
      "/repositories/my-org/my-repo/workflow-runs/run-1/sessions/session-abc",
    );
  });

  it("renders command output for command-type executions", async () => {
    mockParams = {
      id: "run-1",
      executionId: "exec-cmd",
      organization: "my-org",
      name: "my-repo",
    };
    mockRunData = makeRun({
      step_executions: [
        makeExecution({
          id: "exec-cmd",
          step: "lint",
          step_type: "command",
          command_output: "All checks passed",
        }),
      ],
    });

    render(<StepExecutionPage />);
    expect(await screen.findByText("All checks passed")).toBeInTheDocument();
    expect(screen.getByText("command")).toBeInTheDocument();
  });

  it("renders transition decision when available", async () => {
    mockParams = {
      id: "run-1",
      executionId: "exec-1",
      organization: "my-org",
      name: "my-repo",
    };
    mockRunData = makeRun({
      step_executions: [
        makeExecution({
          id: "exec-1",
          step: "plan",
          transition_decision: JSON.stringify({
            transition: "implement",
            reason: "Plan is ready",
            handoff_summary: "Defined implementation steps.",
          }),
        }),
      ],
    });

    render(<StepExecutionPage />);
    expect(await screen.findByText("implement")).toBeInTheDocument();
    expect(screen.getByText("Plan is ready")).toBeInTheDocument();
    expect(
      screen.getByText("Defined implementation steps."),
    ).toBeInTheDocument();
  });

  it("renders completed status when completed_at is set", async () => {
    mockParams = {
      id: "run-1",
      executionId: "exec-1",
      organization: "my-org",
      name: "my-repo",
    };
    mockRunData = makeRun({
      step_executions: [
        makeExecution({
          id: "exec-1",
          step: "plan",
          completed_at: "2024-01-01T00:05:00Z",
        }),
      ],
    });

    render(<StepExecutionPage />);
    // Wait for the heading to confirm data loaded, then check badge
    await screen.findByRole("heading", { level: 1, name: "plan" });
    // "Completed" appears as badge and as detail label
    expect(screen.getAllByText("Completed").length).toBeGreaterThanOrEqual(1);
  });

  it("renders running status when completed_at is null", async () => {
    mockParams = {
      id: "run-1",
      executionId: "exec-1",
      organization: "my-org",
      name: "my-repo",
    };
    mockRunData = makeRun({
      step_executions: [
        makeExecution({
          id: "exec-1",
          step: "build",
          completed_at: null,
        }),
      ],
    });

    render(<StepExecutionPage />);
    expect(await screen.findByText("Running")).toBeInTheDocument();
  });

  it("renders WorkflowBreadcrumb with correct segments", async () => {
    mockParams = {
      id: "run-1",
      executionId: "exec-1",
      organization: "my-org",
      name: "my-repo",
    };
    mockRunData = makeRun({
      id: "run-1",
      repository_path: "/tmp/repos/acme/app",
      worktree_branch: "feat/test",
      workflow_name: "my-flow",
      step_executions: [makeExecution({ id: "exec-1", step: "plan" })],
    });

    render(<StepExecutionPage />);

    // Breadcrumb should show branch and workflow run as links; state as plain text
    expect(
      await screen.findByRole("link", { name: "feat/test" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "my-flow" })).toBeInTheDocument();
    // State name appears in both breadcrumb (current, plain text) and as h1
    expect(screen.getAllByText("plan").length).toBeGreaterThanOrEqual(1);
  });
});
