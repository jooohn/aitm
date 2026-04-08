// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  StepExecution,
  WorkflowRunDetail as WorkflowRunDetailDto,
} from "@/lib/utils/api";
import { SWRTestProvider } from "@/test-swr-provider";
import WorkflowRunDetailComponent from "./WorkflowRunDetail";

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
    fetchRepository: vi.fn().mockResolvedValue({
      path: "/tmp/repo",
      name: "repo",
      alias: "tmp/repo",
      github_url: null,
    }),
    fetchWorkflowRun: vi.fn().mockResolvedValue({
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
    }),
    fetchWorkflows: vi.fn().mockResolvedValue({}),
  };
});

function makeExecution(
  overrides: Partial<StepExecution> & { step: string },
): StepExecution {
  const { step, ...rest } = overrides;
  return {
    id: `${step}-execution`,
    workflow_run_id: "run-1",
    step,
    step_type: "agent",
    status: "success",
    command_output: null,
    session_id: null,
    session_status: null,
    transition_decision: null,
    handoff_summary: null,
    created_at: "2024-01-01T00:00:00Z",
    completed_at: "2024-01-01T00:05:00Z",
    ...rest,
  };
}

function makeRun(
  overrides: Partial<WorkflowRunDetailDto> = {},
): WorkflowRunDetailDto {
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
      <SWRTestProvider>
        <WorkflowRunDetailComponent
          run={makeRun({
            status: "success",
            workflow_name: "my-flow",
            repository_path: "/tmp/repo",
            worktree_branch: "feat/test",
            step_executions: [makeExecution({ step: "plan" })],
          })}
        />
      </SWRTestProvider>,
    );

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("feat/test");
    expect(heading).toHaveTextContent("my-flow");
    expect(heading).toHaveTextContent("(run-1)");
    expect(screen.getAllByText("Success").length).toBeGreaterThan(0);
    expect(screen.getByText("Step executions")).toBeInTheDocument();
    expect(screen.getByText("plan")).toBeInTheDocument();
  });
});

describe("WorkflowRunDetail", () => {
  it("renders command executions in a dedicated output block and leaves agent summaries unchanged", () => {
    const agentExecution = {
      ...makeExecution({
        step: "plan",
        transition_decision: {
          transition: "implement",
          reason: "Plan is ready",
          handoff_summary: "Defined the implementation steps.",
        },
      }),
      step_type: "agent",
    } as StepExecution & { step_type: "agent" };

    const commandExecution = {
      ...makeExecution({
        step: "lint",
        command_output: "stdout line\nstderr line",
        transition_decision: {
          transition: "success",
          reason: "Command succeeded",
          handoff_summary: "stdout line\nstderr line",
        },
      }),
      step_type: "command",
    } as StepExecution & { step_type: "command" };

    render(
      <SWRTestProvider>
        <WorkflowRunDetailComponent
          run={makeRun({
            step_executions: [agentExecution, commandExecution],
          })}
        />
      </SWRTestProvider>,
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
    const metadata = {
      presets__pull_request_url: "https://github.com/org/repo/pull/42",
    };
    render(
      <SWRTestProvider>
        <WorkflowRunDetailComponent run={makeRun({ metadata })} />
      </SWRTestProvider>,
    );

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
    render(
      <SWRTestProvider>
        <WorkflowRunDetailComponent run={makeRun({ metadata: null })} />
      </SWRTestProvider>,
    );

    expect(screen.queryByText(/Pull request created/)).not.toBeInTheDocument();
  });

  it("renders a suggested follow-up workflow when conditions match", async () => {
    const { fetchWorkflowRun, fetchWorkflows } = await import(
      "@/lib/utils/api"
    );
    vi.mocked(fetchWorkflowRun).mockResolvedValueOnce(
      makeRun({
        metadata: {
          presets__pull_request_url: "https://github.com/org/repo/pull/42",
        },
      }),
    );
    const workflows = {
      "my-flow": {
        initial_step: "plan",
        steps: {
          plan: {
            type: "agent",
            goal: "Plan",
            transitions: [{ terminal: "success", when: "done" }],
          },
        },
      },
      "maintain-pr": {
        initial_step: "inspect",
        suggest_if: {
          label: "maintain-pr",
          when: "$.run.metadata.presets__pull_request_url",
          inputs: {
            "pr-url": "$.run.metadata.presets__pull_request_url",
            "source-run-id": "$.run.id",
          },
        },
        inputs: [
          { name: "pr-url", label: "Pull Request URL", required: true },
          { name: "source-run-id", label: "Source Workflow Run ID" },
        ],
        steps: {
          inspect: {
            type: "agent",
            goal: "Inspect",
            transitions: [{ terminal: "success", when: "done" }],
          },
        },
      },
    };
    vi.mocked(fetchWorkflows).mockResolvedValue(workflows);

    const user = userEvent.setup();
    render(
      <SWRTestProvider>
        <WorkflowRunDetailComponent
          run={makeRun({
            metadata: {
              presets__pull_request_url: "https://github.com/org/repo/pull/42",
            },
          })}
        />
      </SWRTestProvider>,
    );

    await user.click(
      await screen.findByRole("button", { name: "Start maintain-pr" }),
    );

    const workflowSelect = (await screen.findByLabelText(
      "Workflow",
    )) as HTMLSelectElement;
    expect(workflowSelect.value).toBe("maintain-pr");
    expect(
      screen.getByDisplayValue("https://github.com/org/repo/pull/42"),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("run-1")).toBeInTheDocument();
  });

  it("only disables the approval buttons for the execution being resolved", async () => {
    const user = userEvent.setup();

    // Create a promise we can control to keep resolving state active
    let resolvePromise!: (value: unknown) => void;
    const pendingPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    const { resolveManualApproval, fetchWorkflowRun } = await import(
      "@/lib/utils/api"
    );
    vi.mocked(resolveManualApproval).mockReturnValue(
      pendingPromise as ReturnType<typeof resolveManualApproval>,
    );

    const exec1 = makeExecution({
      id: "exec-1",
      step: "review-1",
      step_type: "manual-approval",
      status: "awaiting",
      completed_at: null,
    });
    const exec2 = makeExecution({
      id: "exec-2",
      step: "review-2",
      step_type: "manual-approval",
      status: "awaiting",
      completed_at: null,
    });

    const runWithExecs = makeRun({
      status: "running",
      step_executions: [exec1, exec2],
    });

    // Ensure SWR revalidation returns the same run with executions
    vi.mocked(fetchWorkflowRun).mockResolvedValue(runWithExecs);

    render(
      <SWRTestProvider>
        <WorkflowRunDetailComponent run={runWithExecs} />
      </SWRTestProvider>,
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

  it("shows 'Awaiting' badge when step execution status is awaiting", () => {
    const execution = makeExecution({
      step: "implement",
      status: "awaiting",
      completed_at: null,
    });

    render(
      <SWRTestProvider>
        <WorkflowRunDetailComponent
          run={makeRun({
            status: "awaiting",
            step_executions: [execution],
          })}
        />
      </SWRTestProvider>,
    );

    const executionItem = document.getElementById(
      "step-execution-implement-execution",
    )!;
    expect(within(executionItem).getByText("Awaiting")).toBeInTheDocument();
    expect(
      within(executionItem).queryByText("Running"),
    ).not.toBeInTheDocument();
  });

  it("shows 'Running' badge when step execution status is running", () => {
    const execution = makeExecution({
      step: "implement",
      status: "running",
      completed_at: null,
    });

    render(
      <SWRTestProvider>
        <WorkflowRunDetailComponent
          run={makeRun({
            status: "running",
            step_executions: [execution],
          })}
        />
      </SWRTestProvider>,
    );

    const executionItem = document.getElementById(
      "step-execution-implement-execution",
    )!;
    expect(within(executionItem).getByText("Running")).toBeInTheDocument();
    expect(screen.queryByText("Awaiting Input")).not.toBeInTheDocument();
  });
});

describe("StepExecutionItem status-based border", () => {
  it("sets data-status='running' on a running step execution", () => {
    const execution = makeExecution({
      step: "implement",
      status: "running",
      completed_at: null,
    });

    render(
      <SWRTestProvider>
        <WorkflowRunDetailComponent
          run={makeRun({
            status: "running",
            step_executions: [execution],
          })}
        />
      </SWRTestProvider>,
    );

    const executionItem = document.getElementById(
      "step-execution-implement-execution",
    )!;
    expect(executionItem.getAttribute("data-status")).toBe("running");
  });

  it("sets data-status='awaiting' on an awaiting step execution", () => {
    const execution = makeExecution({
      step: "implement",
      status: "awaiting",
      completed_at: null,
    });

    render(
      <SWRTestProvider>
        <WorkflowRunDetailComponent
          run={makeRun({
            status: "awaiting",
            step_executions: [execution],
          })}
        />
      </SWRTestProvider>,
    );

    const executionItem = document.getElementById(
      "step-execution-implement-execution",
    )!;
    expect(executionItem.getAttribute("data-status")).toBe("awaiting");
  });

  it("sets data-status='success' on a completed step execution", () => {
    const execution = makeExecution({
      step: "implement",
      status: "success",
    });

    render(
      <SWRTestProvider>
        <WorkflowRunDetailComponent
          run={makeRun({
            status: "success",
            step_executions: [execution],
          })}
        />
      </SWRTestProvider>,
    );

    const executionItem = document.getElementById(
      "step-execution-implement-execution",
    )!;
    expect(executionItem.getAttribute("data-status")).toBe("success");
  });

  it("sets data-status='awaiting' on a pending manual approval", () => {
    const execution = makeExecution({
      step: "review",
      step_type: "manual-approval",
      status: "awaiting",
      completed_at: null,
    });

    render(
      <SWRTestProvider>
        <WorkflowRunDetailComponent
          run={makeRun({
            status: "running",
            step_executions: [execution],
          })}
        />
      </SWRTestProvider>,
    );

    const executionItem = document.getElementById(
      "step-execution-review-execution",
    )!;
    expect(executionItem.getAttribute("data-status")).toBe("awaiting");
  });
});
