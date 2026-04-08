// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorkflowLaunchForm from "./WorkflowLaunchForm";
import styles from "./WorkflowLaunchForm.module.css";

afterEach(() => {
  cleanup();
});

const defaultProps = {
  workflowNames: ["test-workflow"],
  workflows: {
    "test-workflow": {
      label: "Test Workflow",
      initial_step: "plan",
      inputs: [],
      steps: {
        plan: {
          type: "agent" as const,
          goal: "Create a plan",
          transitions: [{ terminal: "success" as const, when: "done" }],
        },
      },
    },
  },
  selectedWorkflow: "test-workflow",
  onWorkflowChange: vi.fn(),
  inputValues: {},
  onInputChange: vi.fn(),
  onSubmit: vi.fn(),
  isSubmitting: false,
  submitLabel: "Create & launch",
  submittingLabel: "Launching...",
};

describe("WorkflowLaunchForm", () => {
  it("shows submitLabel when not submitting", () => {
    render(<WorkflowLaunchForm {...defaultProps} />);

    const button = screen.getByRole("button", { name: "Create & launch" });
    expect(button).toBeInTheDocument();
  });

  it("does not render a spinner when not submitting", () => {
    render(<WorkflowLaunchForm {...defaultProps} />);

    expect(screen.queryByTestId("submit-spinner")).not.toBeInTheDocument();
  });

  it("renders a spinner inside the button when isSubmitting is true", () => {
    render(<WorkflowLaunchForm {...defaultProps} isSubmitting />);

    const spinner = screen.getByTestId("submit-spinner");
    expect(spinner).toBeInTheDocument();
    expect(spinner).toHaveClass(styles.spinner);
  });

  it("shows submittingLabel text when isSubmitting is true", () => {
    render(<WorkflowLaunchForm {...defaultProps} isSubmitting />);

    expect(screen.getByRole("button")).toHaveTextContent("Launching...");
  });

  it("applies inline-flex alignment to button when submitting", () => {
    render(<WorkflowLaunchForm {...defaultProps} isSubmitting />);

    const button = screen.getByRole("button");
    expect(button).toHaveClass(styles.submitButtonSubmitting);
  });

  it("renders the workflow label in the selector", () => {
    render(<WorkflowLaunchForm {...defaultProps} />);

    expect(screen.getByRole("option", { name: "Test Workflow" })).toHaveValue(
      "test-workflow",
    );
  });

  it("submits when Command+Enter is pressed in a multiline input", () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());

    render(
      <WorkflowLaunchForm
        {...defaultProps}
        onSubmit={onSubmit}
        workflows={{
          "test-workflow": {
            ...defaultProps.workflows["test-workflow"],
            inputs: [
              {
                name: "prompt",
                label: "Prompt",
                type: "multiline-text",
                required: false,
              },
            ],
          },
        }}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText("Prompt"), {
      key: "Enter",
      metaKey: true,
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not submit on plain Enter in a multiline input", () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());

    render(
      <WorkflowLaunchForm
        {...defaultProps}
        onSubmit={onSubmit}
        workflows={{
          "test-workflow": {
            ...defaultProps.workflows["test-workflow"],
            inputs: [
              {
                name: "prompt",
                label: "Prompt",
                type: "multiline-text",
                required: false,
              },
            ],
          },
        }}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText("Prompt"), {
      key: "Enter",
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
