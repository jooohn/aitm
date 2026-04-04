// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
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
}));

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

  it("renders a pull request link when metadata contains a PR URL", () => {
    const metadata = JSON.stringify({
      presets__pull_request_url: "https://github.com/org/repo/pull/42",
    });
    render(<WorkflowRunDetail run={makeRun({ metadata })} />);

    const prLink = screen.getByRole("link", {
      name: "https://github.com/org/repo/pull/42",
    });
    expect(prLink).toBeInTheDocument();
    expect(prLink).toHaveAttribute(
      "href",
      "https://github.com/org/repo/pull/42",
    );
    expect(screen.getByText("Pull request")).toBeInTheDocument();
  });

  it("does not render a pull request row when metadata is null", () => {
    render(<WorkflowRunDetail run={makeRun({ metadata: null })} />);

    expect(screen.queryByText("Pull request")).not.toBeInTheDocument();
  });
});
