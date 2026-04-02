// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/utils/api";
import TodosPage from "./page";

const { fetchSessionsByStatusMock } = vi.hoisted(() => ({
  fetchSessionsByStatusMock: vi.fn(),
}));

vi.mock("@/lib/utils/api", () => ({
  fetchSessionsByStatus: fetchSessionsByStatusMock,
}));

vi.mock("../sessions/[id]/SessionDetail", () => ({
  default: ({
    session,
    onSessionUpdated,
  }: {
    session: Session;
    onSessionUpdated?: (session: Session) => void;
  }) => (
    <div>
      <div data-testid="session-detail">{session.id}</div>
      <button
        type="button"
        onClick={() =>
          onSessionUpdated?.({
            ...session,
            status: "RUNNING",
            updated_at: "2026-04-02T01:00:00.000Z",
          })
        }
      >
        Simulate resume
      </button>
    </div>
  ),
}));

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    repository_path: "/tmp/acme/widgets",
    worktree_branch: "feat/todo-list",
    goal: "Handle awaiting input",
    transitions: "[]",
    transition_decision: null,
    status: "AWAITING_INPUT",
    terminal_attach_command: null,
    log_file_path: "/tmp/session.log",
    claude_session_id: null,
    state_name: "Need review",
    created_at: "2026-04-02T00:00:00.000Z",
    updated_at: "2026-04-02T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  fetchSessionsByStatusMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("/todos page", () => {
  it("loads awaiting-input sessions and selects the first session by default", async () => {
    fetchSessionsByStatusMock.mockResolvedValue([
      makeSession({ id: "session-1", state_name: "First task" }),
      makeSession({ id: "session-2", state_name: "Second task" }),
    ]);

    render(<TodosPage />);

    await waitFor(() => {
      expect(fetchSessionsByStatusMock).toHaveBeenCalledWith("AWAITING_INPUT");
    });

    expect(screen.getByRole("button", { name: /first task/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("session-detail")).toHaveTextContent("session-1");
  });

  it("updates the detail pane when a different session is selected", async () => {
    fetchSessionsByStatusMock.mockResolvedValue([
      makeSession({ id: "session-1", state_name: "First task" }),
      makeSession({ id: "session-2", state_name: "Second task" }),
    ]);

    render(<TodosPage />);

    await screen.findByRole("button", { name: /second task/i });
    fireEvent.click(screen.getByRole("button", { name: /second task/i }));

    expect(
      screen.getByRole("button", { name: /second task/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("session-detail")).toHaveTextContent("session-2");
  });

  it("shows an empty state when there are no awaiting-input sessions", async () => {
    fetchSessionsByStatusMock.mockResolvedValue([]);

    render(<TodosPage />);

    expect(
      await screen.findByText("No sessions are waiting for input."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("session-detail")).not.toBeInTheDocument();
  });

  it("removes a session from the queue when the detail pane reports it is no longer awaiting input", async () => {
    fetchSessionsByStatusMock.mockResolvedValue([
      makeSession({ id: "session-1", state_name: "First task" }),
      makeSession({ id: "session-2", state_name: "Second task" }),
    ]);

    render(<TodosPage />);

    await screen.findByRole("button", { name: /simulate resume/i });
    fireEvent.click(screen.getByRole("button", { name: /simulate resume/i }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /first task/i }),
      ).not.toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: /second task/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("session-detail")).toHaveTextContent("session-2");
  });
});
