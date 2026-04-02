// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/utils/api";
import TodosLayout from "./layout";
import TodosPage from "./page";

const { fetchSessionsByStatusMock } = vi.hoisted(() => ({
  fetchSessionsByStatusMock: vi.fn(),
}));

vi.mock("@/lib/utils/api", () => ({
  fetchSessionsByStatus: fetchSessionsByStatusMock,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/todos",
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
    workflow_name: null,
    workflow_run_id: null,
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

describe("/todos layout", () => {
  it("loads awaiting-input sessions and renders them as links", async () => {
    fetchSessionsByStatusMock.mockResolvedValue([
      makeSession({ id: "session-1", state_name: "First task" }),
      makeSession({ id: "session-2", state_name: "Second task" }),
    ]);

    render(
      <TodosLayout>
        <TodosPage />
      </TodosLayout>,
    );

    await waitFor(() => {
      expect(fetchSessionsByStatusMock).toHaveBeenCalledWith("AWAITING_INPUT");
    });

    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "/todos/session-session-1");
    expect(links[1]).toHaveAttribute("href", "/todos/session-session-2");
  });

  it("shows an empty state when there are no awaiting-input sessions", async () => {
    fetchSessionsByStatusMock.mockResolvedValue([]);

    render(
      <TodosLayout>
        <TodosPage />
      </TodosLayout>,
    );

    expect(
      await screen.findByText("No sessions are waiting for input."),
    ).toBeInTheDocument();
  });

  it("shows the children in the detail pane", async () => {
    fetchSessionsByStatusMock.mockResolvedValue([]);

    render(
      <TodosLayout>
        <TodosPage />
      </TodosLayout>,
    );

    expect(
      await screen.findByText("Select a session to inspect its details."),
    ).toBeInTheDocument();
  });
});
