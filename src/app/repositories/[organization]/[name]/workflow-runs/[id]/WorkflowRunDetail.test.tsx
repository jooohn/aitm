// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StepExecution, WorkflowRunDetail } from "@/lib/utils/api";
import WorkflowRunDetail from "./WorkflowRunDetail";

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
  useParams: () => ({
    organization: "my-org",
    name: "my-repo",
    id: "run-1",
  }),
}));

vi.mock("@/lib/utils/api", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    resolveManualApproval: vi.fn(),
    fetchWorkflowRun: vi.fn().mockResolvedValue({}),
    fetchWorkflows: vi.fn().mockResolvedValue({}),
  };
});

function makeExecution(
  overrides: Partial<StepExecution> & { step: string },
): StepExecution {
  return {
    id: `${overrides.step}-execution`,
    workflow_run_id: "run-1",
    step: overrides.step,
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
    repository_path: "/tmp/repo",
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
});

describe("WorkflowRunDetail layout", () => {
  it("renders header, details, and step executions in a single column", () => {
    render(
      <WorkflowRunDetail
        run={makeRun({
          status: "success",
          workflow_name: "my-flow",
          repository_path: "/tmp/repo",
          worktree_branch: "feat/test",
          step_executions: [makeExecution({ step: "plan" })],
        })}
      />,
    );

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("feat/test");
    expect(heading).toHaveTextContent("my-flow");
    expect(heading).toHaveTextContent("(run-1)");
    expect(screen.getByText("Success")).toBeInTheDocument();
    expect(screen.getByText("Step executions")).toBeInTheDocument();
    expect(screen.getByText("plan")).toBeInTheDocument();
  });
});

describe("WorkflowRunDetail", () => {
  it("renders command executions in a dedicated output block and leaves agent summaries unchanged", () => {
    const agentExecution = {
      ...makeExecution({
        step: "plan",
        transition_decision: JSON.stringify({
          transition: "implement",
          reason: "Plan is ready",
          handoff_summary: "Defined the implementation steps.",
        }),
      }),
      step_type: "agent",
    } as StepExecution & { step_type: "agent" };

    const commandExecution = {
      ...makeExecution({
        step: "lint",
        command_output: "stdout line\nstderr line",
        transition_decision: JSON.stringify({
          transition: "success",
          reason: "Command succeeded",
          handoff_summary: "stdout line\nstderr line",
        }),
      }),
      step_type: "command",
    } as StepExecution & { step_type: "command" };

    render(
      <WorkflowRunDetail
        run={makeRun({
          step_executions: [agentExecution, commandExecution],
        })}
      />,
    );

    expect(screen.getByText("Plan is ready")).toBeInTheDocument();
    expect(
      screen.getByText("Defined the implementation steps."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Reason")).toHaveLength(1);
    expect(screen.getAllByText("Summary")).toHaveLength(1);

    const commandItem = screen.getByText("lint").closest("li");
    expect(commandItem).not.toBeNull();
    const commandOutput = within(commandItem!).getByTestId(
      "command-output-lint-execution",
    );
    expect(commandOutput).toHaveTextContent("stdout line");
    expect(commandOutput).toHaveTextContent("stderr line");
    expect(within(commandItem!).queryByText("Command succeeded")).toBeNull();
  });

  it("renders a pull request banner when metadata contains a PR URL", () => {
    const metadata = JSON.stringify({
      presets__pull_request_url: "https://github.com/org/repo/pull/42",
    });
    render(<WorkflowRunDetail run={makeRun({ metadata })} />);

    const prLink = screen.getByRole("link", {
      name: /Pull request created/,
    });
    expect(prLink).toBeInTheDocument();
    expect(prLink).toHaveAttribute(
      "href",
      "https://github.com/org/repo/pull/42",
    );
    expect(prLink).toHaveTextContent("org/repo#42");
  });

  it("does not render a pull request banner when metadata is null", () => {
    render(<WorkflowRunDetail run={makeRun({ metadata: null })} />);

    expect(screen.queryByText(/Pull request created/)).not.toBeInTheDocument();
  });

  it("only disables the approval buttons for the execution being resolved", async () => {
    const user = userEvent.setup();

    // Create a promise we can control to keep resolving state active
    let resolvePromise!: (value: unknown) => void;
    const pendingPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    const { resolveManualApproval } = await import("@/lib/utils/api");
    vi.mocked(resolveManualApproval).mockReturnValue(
      pendingPromise as ReturnType<typeof resolveManualApproval>,
    );

    const exec1 = makeExecution({
      id: "exec-1",
      step: "review-1",
      step_type: "manual-approval",
      completed_at: null,
    });
    const exec2 = makeExecution({
      id: "exec-2",
      step: "review-2",
      step_type: "manual-approval",
      completed_at: null,
    });

    render(
      <WorkflowRunDetail
        run={makeRun({
          status: "running",
          step_executions: [exec1, exec2],
        })}
      />,
    );

    // Both executions should have enabled Approve buttons
    const approveButtons = screen.getAllByRole("button", { name: "Approve" });
    expect(approveButtons).toHaveLength(2);
    expect(approveButtons[0]).not.toBeDisabled();
    expect(approveButtons[1]).not.toBeDisabled();

    // Click Approve on the first execution (rendered last due to reverse order)
    await user.click(approveButtons[0]);

    // Get all buttons in approval action areas
    const allButtons = screen.getAllByRole("button");
    const approvalButtons = allButtons.filter(
      (b) =>
        b.textContent === "Approve" ||
        b.textContent === "Reject" ||
        b.textContent === "…",
    );
    // 4 total buttons: 2 per execution (Approve + Reject for non-resolving, … + … for resolving)
    expect(approvalButtons).toHaveLength(4);
    const disabledCount = approvalButtons.filter((b) =>
      b.hasAttribute("disabled"),
    ).length;
    const enabledCount = approvalButtons.filter(
      (b) => !b.hasAttribute("disabled"),
    ).length;
    expect(disabledCount).toBe(2); // … + … for the resolving execution
    expect(enabledCount).toBe(2); // Approve + Reject for the other execution

    // Clean up
    await act(async () => {
      resolvePromise(
        makeRun({ status: "running", step_executions: [exec1, exec2] }),
      );
    });
  });
});
