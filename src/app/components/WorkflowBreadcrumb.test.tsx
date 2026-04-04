// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorkflowBreadcrumb from "./WorkflowBreadcrumb";

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

afterEach(() => {
  cleanup();
});

describe("WorkflowBreadcrumb", () => {
  const repository = { organization: "acme", name: "app" };

  it("renders only repository as plain text when it is the final segment", () => {
    render(<WorkflowBreadcrumb repository={repository} />);

    expect(screen.getByText("acme/app")).toBeInTheDocument();
    // Should be plain text, not a link
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders repository as link and branch as plain text", () => {
    render(<WorkflowBreadcrumb repository={repository} branch="main" />);

    const repoLink = screen.getByRole("link", { name: "acme/app" });
    expect(repoLink).toHaveAttribute("href", "/repositories/acme/app");

    // Branch should be plain text (current page)
    expect(screen.getByText("main")).toBeInTheDocument();
    // Only one link (repo)
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("renders repository and branch as links, workflow run as plain text", () => {
    render(
      <WorkflowBreadcrumb
        repository={repository}
        branch="feat/new"
        workflowRun={{ id: "run-123", name: "deploy" }}
      />,
    );

    expect(screen.getByRole("link", { name: "acme/app" })).toHaveAttribute(
      "href",
      "/repositories/acme/app",
    );
    expect(screen.getByRole("link", { name: "feat/new" })).toHaveAttribute(
      "href",
      "/repositories/acme/app/worktrees/feat/new",
    );

    // Workflow name should be plain text (current page)
    expect(screen.getByText("deploy")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("renders up to state execution with all preceding as links", () => {
    render(
      <WorkflowBreadcrumb
        repository={repository}
        branch="feat/new"
        workflowRun={{ id: "run-123", name: "deploy" }}
        stepExecution={{
          id: "exec-456",
          workflowRunId: "run-123",
          stepName: "build",
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "acme/app" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "feat/new" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "deploy" })).toHaveAttribute(
      "href",
      "/workflow-runs/run-123",
    );

    // State execution is current page → plain text
    expect(screen.getByText("build")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("renders full breadcrumb with session label as plain text", () => {
    render(
      <WorkflowBreadcrumb
        repository={repository}
        branch="feat/new"
        workflowRun={{ id: "run-123", name: "deploy" }}
        stepExecution={{
          id: "exec-456",
          workflowRunId: "run-123",
          stepName: "build",
        }}
        sessionLabel="Session abc12345"
      />,
    );

    expect(screen.getByRole("link", { name: "acme/app" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "feat/new" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "deploy" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "build" })).toHaveAttribute(
      "href",
      "/workflow-runs/run-123/step-executions/exec-456",
    );

    // Session label is current page → plain text
    expect(screen.getByText("Session abc12345")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(4);
  });

  it("renders separators between segments", () => {
    render(<WorkflowBreadcrumb repository={repository} branch="main" />);

    // At least one separator between repo link and branch text
    expect(screen.getByText("/")).toBeInTheDocument();
  });

  it("renders as a nav element", () => {
    render(<WorkflowBreadcrumb repository={repository} />);
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });
});
