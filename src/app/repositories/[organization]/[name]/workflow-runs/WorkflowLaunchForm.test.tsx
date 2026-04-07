// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
    "test-workflow": { inputs: [] },
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
});
