// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StepExecution } from "@/lib/utils/api";
import StepExecutionItem from "./StepExecutionItem";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
});

function buildExecution(overrides: Partial<StepExecution> = {}): StepExecution {
  return {
    id: "exec-1",
    workflow_run_id: "run-1",
    step: "build",
    step_type: "command",
    status: "success",
    output_file_path: null,
    session_id: null,
    session_status: null,
    command_execution_id: null,
    transition_decision: null,
    handoff_summary: null,
    created_at: "2026-04-13T00:00:00Z",
    completed_at: null,
    ...overrides,
  };
}

const basePath = "/repos/org/repo/workflow-runs/run-1";

describe("StepExecutionItem – command step output link", () => {
  it("renders the output link in the meta section for a command step with output", () => {
    const execution = buildExecution({
      step_type: "command",
      output_file_path: "/logs/build-output.txt",
    });

    render(
      <StepExecutionItem
        execution={execution}
        isCurrent={false}
        runBasePath={basePath}
      />,
    );

    const link = screen.getByRole("link", { name: /Output build-output\.txt/ });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute(
      "href",
      `${basePath}/command-outputs/build-output.txt`,
    );
  });

  it("does not render any output link when there is no output file", () => {
    const execution = buildExecution({
      step_type: "command",
      output_file_path: null,
    });

    render(
      <StepExecutionItem
        execution={execution}
        isCurrent={false}
        runBasePath={basePath}
      />,
    );

    expect(screen.queryByText(/Output/)).not.toBeInTheDocument();
  });

  it("does not render the decision section for a command step without a transition decision", () => {
    const execution = buildExecution({
      step_type: "command",
      output_file_path: "/logs/build-output.txt",
      transition_decision: null,
    });

    const { container } = render(
      <StepExecutionItem
        execution={execution}
        isCurrent={false}
        runBasePath={basePath}
      />,
    );

    expect(
      container.querySelector("[class*='decision']"),
    ).not.toBeInTheDocument();
  });

  it("renders the decision section for a command step with a transition decision", () => {
    const execution = buildExecution({
      step_type: "command",
      transition_decision: {
        transition: "success",
        reason: "Build passed",
        handoff_summary: "All good",
      },
    });

    render(
      <StepExecutionItem
        execution={execution}
        isCurrent={false}
        runBasePath={basePath}
      />,
    );

    expect(screen.getByText("success")).toBeInTheDocument();
  });

  it("does not render the terminal-styled command output block", () => {
    const execution = buildExecution({
      step_type: "command",
      output_file_path: "/logs/build-output.txt",
    });

    const { container } = render(
      <StepExecutionItem
        execution={execution}
        isCurrent={false}
        runBasePath={basePath}
      />,
    );

    expect(
      container.querySelector("[class*='commandOutput']"),
    ).not.toBeInTheDocument();
  });
});
