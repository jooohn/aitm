// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRun } from "@/lib/utils/api";
import { SWRTestProvider } from "@/test-swr-provider";
import TodosLayout from "./layout";
import TodosPage from "./page";

const { fetchAllWorkflowRunsMock } = vi.hoisted(() => ({
  fetchAllWorkflowRunsMock: vi.fn(),
}));

vi.mock("@/lib/utils/api", () => ({
  fetchAllWorkflowRuns: fetchAllWorkflowRunsMock,
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

const mockReplace = vi.fn();
let mockPathname = "/todos";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ replace: mockReplace }),
}));

function makeWorkflowRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run-1",
    organization: "acme",
    name: "widgets",
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
  mockReplace.mockReset();
  mockPathname = "/todos";
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
      <SWRTestProvider>
        <TodosLayout>
          <TodosPage />
        </TodosLayout>
      </SWRTestProvider>,
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
      <SWRTestProvider>
        <TodosLayout>
          <TodosPage />
        </TodosLayout>
      </SWRTestProvider>,
    );

    expect(
      await screen.findByText("No items are waiting for action."),
    ).toBeInTheDocument();
  });

  it("shows the children in the detail pane", async () => {
    fetchAllWorkflowRunsMock.mockResolvedValue([]);

    render(
      <SWRTestProvider>
        <TodosLayout>
          <TodosPage />
        </TodosLayout>
      </SWRTestProvider>,
    );

    expect(
      await screen.findByText("Select an item to inspect its details."),
    ).toBeInTheDocument();
  });

  it("auto-selects the first item when pathname is /todos", async () => {
    mockPathname = "/todos";
    fetchAllWorkflowRunsMock.mockResolvedValue([
      makeWorkflowRun({ id: "run-1" }),
      makeWorkflowRun({ id: "run-2" }),
    ]);

    render(
      <SWRTestProvider>
        <TodosLayout>
          <TodosPage />
        </TodosLayout>
      </SWRTestProvider>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/todos/run-1");
    });
  });

  it("does not auto-select when an item is already selected", async () => {
    mockPathname = "/todos/run-2";
    fetchAllWorkflowRunsMock.mockResolvedValue([
      makeWorkflowRun({ id: "run-1" }),
      makeWorkflowRun({ id: "run-2" }),
    ]);

    render(
      <SWRTestProvider>
        <TodosLayout>
          <TodosPage />
        </TodosLayout>
      </SWRTestProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByRole("link")).toHaveLength(2);
    });

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("does not auto-select when there are no items", async () => {
    mockPathname = "/todos";
    fetchAllWorkflowRunsMock.mockResolvedValue([]);

    render(
      <SWRTestProvider>
        <TodosLayout>
          <TodosPage />
        </TodosLayout>
      </SWRTestProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByText("No items are waiting for action."),
      ).toBeInTheDocument();
    });

    expect(mockReplace).not.toHaveBeenCalled();
  });
});
