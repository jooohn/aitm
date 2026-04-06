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

  it("renders goal text in the goal section", () => {
    const session = makeSession({
      goal: "The full goal text",
      step_name: "Implementing",
    });
    render(<SessionDetail session={session} />);
    expect(screen.getByText("The full goal text")).toBeInTheDocument();
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

    expect(screen.getByText("Second goal")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.queryByText("Awaiting input")).not.toBeInTheDocument();
  });
});
