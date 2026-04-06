// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { Session } from "@/lib/utils/api";
import SessionDetail from "./SessionDetail";

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

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "test-session-id",
    repository_path: "/tmp/repos/acme/app",
    worktree_branch: "main",
    goal: "Implement a feature",
    transitions: "[]",
    transition_decision: null,
    step_name: null,
    workflow_name: null,
    workflow_run_id: null,
    step_execution_id: null,
    status: "RUNNING",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    terminal_attach_command: null,
    log_file_path: "/tmp/session.log",
    claude_session_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "EventSource",
    class {
      onmessage = null;
      onerror = null;
      addEventListener = vi.fn();
      close = vi.fn();
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SessionDetail – goal section", () => {
  it("renders goal text in the Goal section", () => {
    const session = makeSession({ goal: "Build the feature" });
    render(<SessionDetail session={session} />);
    expect(screen.getByText("Build the feature")).toBeInTheDocument();
  });

  it("renders stateName as h1 when present", () => {
    const session = makeSession({
      goal: "The full goal text",
      step_name: "Implementing",
    });
    render(<SessionDetail session={session} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Implementing",
    );
  });

  it("does not render h1 when stateName is absent", () => {
    const session = makeSession({ step_name: null });
    render(<SessionDetail session={session} />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
});

describe("SessionDetail – status and updates", () => {
  it("updates the rendered session when the parent provides a different session", () => {
    const { rerender } = render(
      <SessionDetail
        session={makeSession({
          id: "session-1",
          goal: "First goal",
          step_name: "First state",
          status: "AWAITING_INPUT",
        })}
      />,
    );

    rerender(
      <SessionDetail
        session={makeSession({
          id: "session-2",
          goal: "Second goal",
          step_name: "Second state",
          status: "FAILED",
        })}
      />,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Second state",
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.queryByText("Awaiting input")).not.toBeInTheDocument();
  });
});

describe("SessionDetail – breadcrumb with step_execution_id", () => {
  it("renders state name as a link to state-execution page when step_execution_id is present", () => {
    const session = makeSession({
      repository_path: "/tmp/repos/acme/app",
      worktree_branch: "feat/new",
      workflow_name: "deploy",
      workflow_run_id: "run-123",
      step_name: "build",
      step_execution_id: "exec-456",
    });
    render(<SessionDetail session={session} />);

    // State name should be a link in the breadcrumb (not current page – session is current)
    const stateLink = screen.getByRole("link", { name: "build" });
    expect(stateLink).toHaveAttribute(
      "href",
      "/repositories/acme/app/workflow-runs/run-123/step-executions/exec-456",
    );
  });

  it("renders state name as plain text when step_execution_id is absent", () => {
    const session = makeSession({
      workflow_name: "deploy",
      workflow_run_id: "run-123",
      step_name: "build",
      step_execution_id: null,
    });
    render(<SessionDetail session={session} />);

    // step_name should appear but not as a link in the breadcrumb
    expect(screen.getAllByText("build").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("link", { name: "build" })).toBeNull();
  });
});
