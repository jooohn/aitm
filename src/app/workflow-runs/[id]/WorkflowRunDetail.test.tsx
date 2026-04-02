// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StateExecution, WorkflowRunDetail } from "@/lib/utils/api";
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
  overrides: Partial<StateExecution> & { state: string },
): StateExecution {
  return {
    id: `${overrides.state}-execution`,
    workflow_run_id: "run-1",
    state: overrides.state,
    state_type: "agent",
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
    current_state: null,
    status: "success",
    inputs: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:05:00Z",
    state_executions: [],
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
        state: "plan",
        transition_decision: JSON.stringify({
          transition: "implement",
          reason: "Plan is ready",
          handoff_summary: "Defined the implementation steps.",
        }),
      }),
      state_type: "agent",
    } as StateExecution & { state_type: "agent" };

    const commandExecution = {
      ...makeExecution({
        state: "lint",
        command_output: "stdout line\nstderr line",
        transition_decision: JSON.stringify({
          transition: "success",
          reason: "Command succeeded",
          handoff_summary: "stdout line\nstderr line",
        }),
      }),
      state_type: "command",
    } as StateExecution & { state_type: "command" };

    render(
      <WorkflowRunDetail
        run={makeRun({
          state_executions: [agentExecution, commandExecution],
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
});
