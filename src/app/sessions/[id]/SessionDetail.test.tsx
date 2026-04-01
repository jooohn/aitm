// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { Session } from "@/lib/utils/api";
import SessionDetail from "./SessionDetail";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "test-session-id",
    repository_path: "/tmp/repo",
    worktree_branch: "main",
    goal: "Implement a feature",
    transitions: "[]",
    transition_decision: null,
    state_name: null,
    status: "RUNNING",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    terminal_attach_command: null,
    log_file_path: "/tmp/session.log",
    claude_session_id: null,
    ...overrides,
  };
}

// Simulate a measure node that reports overflow so canExpandGoal becomes true
function simulateOverflow() {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => 100,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 40,
  });
}

function restoreHeights() {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => 0,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 0,
  });
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
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  restoreHeights();
});

describe("SessionDetail – no stateName (goal shown as h1)", () => {
  it("renders goalText in the h1 when stateName is absent", () => {
    const session = makeSession({
      goal: "Build the feature",
      state_name: null,
    });
    render(<SessionDetail session={session} initialMessages={[]} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Build the feature",
    );
  });

  it("renders an aria-hidden measure h1 for overflow detection when stateName is absent", () => {
    const session = makeSession({
      goal: "Build the feature",
      state_name: null,
    });
    render(<SessionDetail session={session} initialMessages={[]} />);
    // The invisible measure node must exist so overflow can be detected
    const measureNode = document.querySelector("h1[aria-hidden='true']");
    expect(measureNode).not.toBeNull();
    expect(measureNode).toHaveTextContent("Build the feature");
  });

  it("does not show 'Show more' button when goal text does not overflow", () => {
    const session = makeSession({ goal: "Short goal", state_name: null });
    render(<SessionDetail session={session} initialMessages={[]} />);
    expect(screen.queryByRole("button", { name: /show more/i })).toBeNull();
  });

  it("shows 'Show more' button when the goal measure node reports overflow", () => {
    simulateOverflow();
    const session = makeSession({ goal: "A".repeat(500), state_name: null });
    render(<SessionDetail session={session} initialMessages={[]} />);
    expect(
      screen.getByRole("button", { name: /show more/i }),
    ).toBeInTheDocument();
  });

  it("expands goal text and shows 'Show less' when 'Show more' is clicked", () => {
    simulateOverflow();
    const session = makeSession({ goal: "A".repeat(500), state_name: null });
    render(<SessionDetail session={session} initialMessages={[]} />);

    fireEvent.click(screen.getByRole("button", { name: /show more/i }));
    expect(
      screen.getByRole("button", { name: /show less/i }),
    ).toBeInTheDocument();
  });

  it("collapses goal text and shows 'Show more' when 'Show less' is clicked", () => {
    simulateOverflow();
    const session = makeSession({ goal: "A".repeat(500), state_name: null });
    render(<SessionDetail session={session} initialMessages={[]} />);

    fireEvent.click(screen.getByRole("button", { name: /show more/i }));
    fireEvent.click(screen.getByRole("button", { name: /show less/i }));
    expect(
      screen.getByRole("button", { name: /show more/i }),
    ).toBeInTheDocument();
  });
});

describe("SessionDetail – with stateName (existing behavior unchanged)", () => {
  it("renders stateName in the h1 when stateName is present", () => {
    const session = makeSession({
      goal: "The full goal text",
      state_name: "Implementing",
    });
    render(<SessionDetail session={session} initialMessages={[]} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Implementing",
    );
  });

  it("renders goalText as subtitle paragraph when stateName is present", () => {
    const session = makeSession({
      goal: "The full goal text",
      state_name: "Implementing",
    });
    render(<SessionDetail session={session} initialMessages={[]} />);
    // Visible subtitle (not aria-hidden) should contain goalText
    const subtitle = document.querySelector("p:not([aria-hidden])");
    expect(subtitle).toHaveTextContent("The full goal text");
  });
});
