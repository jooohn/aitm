// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRun } from "@/lib/utils/api";
import TodosLayout from "./layout";
import TodosPage from "./page";

const { fetchAllWorkflowRunsMock } = vi.hoisted(() => ({
  fetchAllWorkflowRunsMock: vi.fn(),
}));

vi.mock("@/lib/utils/api", () => ({
  fetchAllWorkflowRuns: fetchAllWorkflowRunsMock,
}));

let capturedCallback: (() => void) | null = null;

vi.mock("@/lib/hooks/useNotificationStream", () => ({
  useNotificationStream: (cb: () => void) => {
    capturedCallback = cb;
  },
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

function makeWorkflowRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run-1",
    repository_path: "/tmp/acme/widgets",
    worktree_branch: "feat/todo-list",
    workflow_name: "default",
    current_step: "implement",
    status: "awaiting",
    inputs: null,
    metadata: null,
    created_at: "2026-04-02T00:00:00.000Z",
    updated_at: "2026-04-02T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  fetchAllWorkflowRunsMock.mockReset();
  capturedCallback = null;
});

afterEach(() => {
  cleanup();
});

describe("/todos layout", () => {
  it("loads awaiting workflow runs and renders them as links", async () => {
    fetchAllWorkflowRunsMock.mockResolvedValue([
      makeWorkflowRun({ id: "run-1", current_step: "implement" }),
      makeWorkflowRun({ id: "run-2", current_step: "review" }),
    ]);

    render(
      <TodosLayout>
        <TodosPage />
      </TodosLayout>,
    );

    await waitFor(() => {
      expect(fetchAllWorkflowRunsMock).toHaveBeenCalledWith("awaiting");
    });

    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "/todos/run-1");
    expect(links[1]).toHaveAttribute("href", "/todos/run-2");
  });

  it("shows an empty state when there are no awaiting workflow runs", async () => {
    fetchAllWorkflowRunsMock.mockResolvedValue([]);

    render(
      <TodosLayout>
        <TodosPage />
      </TodosLayout>,
    );

    expect(
      await screen.findByText("No items are waiting for action."),
    ).toBeInTheDocument();
  });

  it("shows the children in the detail pane", async () => {
    fetchAllWorkflowRunsMock.mockResolvedValue([]);

    render(
      <TodosLayout>
        <TodosPage />
      </TodosLayout>,
    );

    expect(
      await screen.findByText("Select an item to inspect its details."),
    ).toBeInTheDocument();
  });

  it("re-fetches workflow runs when notification stream fires", async () => {
    fetchAllWorkflowRunsMock
      .mockResolvedValueOnce([
        makeWorkflowRun({ id: "run-1", current_step: "implement" }),
      ])
      .mockResolvedValueOnce([
        makeWorkflowRun({ id: "run-1", current_step: "implement" }),
        makeWorkflowRun({ id: "run-2", current_step: "review" }),
      ]);

    render(
      <TodosLayout>
        <TodosPage />
      </TodosLayout>,
    );

    await waitFor(() => {
      expect(screen.getAllByRole("link")).toHaveLength(1);
    });

    // Simulate SSE message via captured callback
    act(() => {
      capturedCallback!();
    });

    await waitFor(() => {
      expect(screen.getAllByRole("link")).toHaveLength(2);
    });
  });
});
