// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDefinition, WorkflowRun } from "@/lib/utils/api";
import WorkflowKanbanBoard from "./WorkflowKanbanBoard";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const WORKFLOW_DEF: WorkflowDefinition = {
  initial_step: "plan",
  steps: {
    plan: {
      goal: "Create a plan",
      transitions: [
        { step: "implement", when: "plan approved" },
        { terminal: "failure", when: "plan rejected" },
      ],
    },
    implement: {
      goal: "Implement the plan",
      transitions: [
        { step: "review", when: "implementation done" },
        { terminal: "failure", when: "implementation failed" },
      ],
    },
    review: {
      goal: "Review the code",
      transitions: [
        { terminal: "success", when: "review passed" },
        { step: "implement", when: "review rejected" },
      ],
    },
  },
};

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run-1",
    repository_path: "/repos/org/name",
    worktree_branch: "feature-branch",
    workflow_name: "default",
    current_step: "plan",
    status: "running",
    inputs: null,
    metadata: null,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

const { fetchWorkflowsMock, fetchWorkflowRunsMock, fetchAllWorkflowRunsMock } =
  vi.hoisted(() => ({
    fetchWorkflowsMock: vi.fn(),
    fetchWorkflowRunsMock: vi.fn(),
    fetchAllWorkflowRunsMock: vi.fn(),
  }));

vi.mock("@/lib/utils/api", async () => {
  const actual = await vi.importActual("@/lib/utils/api");
  return {
    ...actual,
    fetchWorkflows: fetchWorkflowsMock,
    fetchWorkflowRuns: fetchWorkflowRunsMock,
    fetchAllWorkflowRuns: fetchAllWorkflowRunsMock,
  };
});

beforeEach(() => {
  fetchWorkflowsMock.mockResolvedValue({ default: WORKFLOW_DEF });
  fetchWorkflowRunsMock.mockResolvedValue([]);
  fetchAllWorkflowRunsMock.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorkflowKanbanBoard", () => {
  it("renders 'Workflow Runs' as the section heading", async () => {
    fetchWorkflowRunsMock.mockResolvedValue([
      makeRun({ id: "r1", current_step: "plan" }),
    ]);

    render(
      <WorkflowKanbanBoard
        repositoryPath="/repos/org/name"
        activeWorktreeBranches={null}
      />,
    );

    await screen.findByText("feature-branch");
    expect(
      screen.getByRole("heading", { level: 2, name: "Workflow Runs" }),
    ).toBeInTheDocument();
  });

  it("renders columns in topological order plus terminal columns", async () => {
    fetchWorkflowRunsMock.mockResolvedValue([
      makeRun({ id: "r1", current_step: "plan" }),
    ]);

    render(
      <WorkflowKanbanBoard
        repositoryPath="/repos/org/name"
        activeWorktreeBranches={null}
      />,
    );

    // Wait for data to load
    await screen.findByText("plan");

    const columnHeaders = screen.getAllByRole("columnheader");
    const headerTexts = columnHeaders.map((h) => h.textContent);
    expect(headerTexts).toEqual(["plan", "implement", "review", "Success"]);
  });

  it("places running workflow runs in their current_step column", async () => {
    fetchWorkflowRunsMock.mockResolvedValue([
      makeRun({
        id: "r1",
        current_step: "implement",
        worktree_branch: "feat-a",
      }),
    ]);

    render(
      <WorkflowKanbanBoard
        repositoryPath="/repos/org/name"
        activeWorktreeBranches={null}
      />,
    );

    await screen.findByText("feat-a");

    // The card should link to the workflow run detail page
    const link = screen.getByRole("link", { name: /feat-a/ });
    expect(link).toHaveAttribute(
      "href",
      "/repositories/org/name/workflow-runs/r1",
    );
  });

  it("places successful runs in the Success column", async () => {
    fetchWorkflowRunsMock.mockResolvedValue([
      makeRun({
        id: "r1",
        current_step: null,
        status: "success",
        worktree_branch: "feat-done",
      }),
    ]);

    render(
      <WorkflowKanbanBoard
        repositoryPath="/repos/org/name"
        activeWorktreeBranches={null}
      />,
    );

    await screen.findByText("feat-done");

    // Find the Success column and check card is inside it
    const successHeader = screen.getByRole("columnheader", { name: "Success" });
    const successColumn = successHeader.closest("[data-column]")!;
    expect(
      within(successColumn as HTMLElement).getByText("feat-done"),
    ).toBeInTheDocument();
  });

  it("places failed runs in their current_step column with failure styling", async () => {
    fetchWorkflowRunsMock.mockResolvedValue([
      makeRun({
        id: "r2",
        current_step: "implement",
        status: "failure",
        worktree_branch: "feat-fail",
      }),
    ]);

    render(
      <WorkflowKanbanBoard
        repositoryPath="/repos/org/name"
        activeWorktreeBranches={null}
      />,
    );

    await screen.findByText("feat-fail");

    // Should be in the "implement" column, not a "Failure" column
    const implementHeader = screen.getByRole("columnheader", {
      name: "implement",
    });
    const implementColumn = implementHeader.closest("[data-column]")!;
    expect(
      within(implementColumn as HTMLElement).getByText("feat-fail"),
    ).toBeInTheDocument();

    // Should have failure card styling
    const card = screen.getByText("feat-fail").closest("a")!;
    expect(card.className).toContain("cardFailure");
  });

  it("filters runs by active worktree branches when provided", async () => {
    fetchWorkflowRunsMock.mockResolvedValue([
      makeRun({
        id: "r1",
        worktree_branch: "active-branch",
        current_step: "plan",
      }),
      makeRun({
        id: "r2",
        worktree_branch: "stale-branch",
        current_step: "plan",
      }),
    ]);

    render(
      <WorkflowKanbanBoard
        repositoryPath="/repos/org/name"
        activeWorktreeBranches={["active-branch"]}
      />,
    );

    await screen.findByText("active-branch");
    expect(screen.queryByText("stale-branch")).not.toBeInTheDocument();
  });

  it("always renders workflow name as heading", async () => {
    fetchWorkflowRunsMock.mockResolvedValue([
      makeRun({ id: "r1", current_step: "plan" }),
    ]);

    render(
      <WorkflowKanbanBoard
        repositoryPath="/repos/org/name"
        activeWorktreeBranches={null}
      />,
    );

    await screen.findByText("feature-branch");
    expect(
      screen.getByRole("heading", { level: 3, name: "default" }),
    ).toBeInTheDocument();
  });

  it("groups runs by workflow_name and renders separate boards", async () => {
    const otherDef: WorkflowDefinition = {
      initial_step: "build",
      steps: {
        build: {
          goal: "Build",
          transitions: [{ terminal: "success", when: "done" }],
        },
      },
    };

    fetchWorkflowsMock.mockResolvedValue({
      default: WORKFLOW_DEF,
      deploy: otherDef,
    });

    fetchWorkflowRunsMock.mockResolvedValue([
      makeRun({ id: "r1", workflow_name: "default", current_step: "plan" }),
      makeRun({
        id: "r2",
        workflow_name: "deploy",
        current_step: "build",
        worktree_branch: "deploy-branch",
      }),
    ]);

    render(
      <WorkflowKanbanBoard
        repositoryPath="/repos/org/name"
        activeWorktreeBranches={null}
      />,
    );

    await screen.findByText("feature-branch");

    // Should render both workflow names as headings
    expect(screen.getByText("default")).toBeInTheDocument();
    expect(screen.getByText("deploy")).toBeInTheDocument();
  });

  it("shows loading state initially", () => {
    render(
      <WorkflowKanbanBoard
        repositoryPath="/repos/org/name"
        activeWorktreeBranches={null}
      />,
    );

    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("keeps the board visible during refreshes after the first load", async () => {
    const nextRuns = deferred<WorkflowRun[]>();
    fetchWorkflowRunsMock
      .mockResolvedValueOnce([
        makeRun({ id: "r1", workflow_name: "default", current_step: "plan" }),
      ])
      .mockReturnValueOnce(nextRuns.promise);

    const { rerender } = render(
      <WorkflowKanbanBoard
        repositoryPath="/repos/org/name"
        activeWorktreeBranches={null}
        refreshKey={0}
      />,
    );

    await screen.findByText("feature-branch");

    rerender(
      <WorkflowKanbanBoard
        repositoryPath="/repos/org/name"
        activeWorktreeBranches={null}
        refreshKey={1}
      />,
    );

    expect(screen.getByText("feature-branch")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();

    nextRuns.resolve([
      makeRun({ id: "r1", workflow_name: "default", current_step: "plan" }),
    ]);
  });

  it("makes the entire card a link to the workflow run detail", async () => {
    fetchWorkflowRunsMock.mockResolvedValue([
      makeRun({ id: "r1", current_step: "review" }),
    ]);

    render(
      <WorkflowKanbanBoard
        repositoryPath="/repos/org/name"
        activeWorktreeBranches={null}
      />,
    );

    await screen.findByText("feature-branch");

    const cardLink = screen.getByRole("link", { name: /feature-branch/ });
    expect(cardLink).toBeInTheDocument();
  });

  it("shows status badge on cards", async () => {
    fetchWorkflowRunsMock.mockResolvedValue([
      makeRun({ id: "r1", current_step: "plan", status: "running" }),
    ]);

    render(
      <WorkflowKanbanBoard
        repositoryPath="/repos/org/name"
        activeWorktreeBranches={null}
      />,
    );

    await screen.findByText("feature-branch");
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  describe("card status border styling", () => {
    it("applies cardSuccess class to successful run cards", async () => {
      fetchWorkflowRunsMock.mockResolvedValue([
        makeRun({
          id: "r1",
          current_step: null,
          status: "success",
          worktree_branch: "feat-done",
        }),
      ]);

      render(
        <WorkflowKanbanBoard
          repositoryPath="/repos/org/name"
          activeWorktreeBranches={null}
        />,
      );

      await screen.findByText("feat-done");

      const card = screen.getByText("feat-done").closest("a")!;
      expect(card.className).toContain("cardSuccess");
    });

    it("applies cardRunning class to running run cards", async () => {
      fetchWorkflowRunsMock.mockResolvedValue([
        makeRun({
          id: "r1",
          current_step: "plan",
          status: "running",
          worktree_branch: "feat-wip",
        }),
      ]);

      render(
        <WorkflowKanbanBoard
          repositoryPath="/repos/org/name"
          activeWorktreeBranches={null}
        />,
      );

      await screen.findByText("feat-wip");

      const card = screen.getByText("feat-wip").closest("a")!;
      expect(card.className).toContain("cardRunning");
    });
  });

  it("renders workflow sections in config definition order, not run-data order", async () => {
    const deployDef: WorkflowDefinition = {
      initial_step: "build",
      steps: {
        build: {
          goal: "Build",
          transitions: [{ terminal: "success", when: "done" }],
        },
      },
    };
    const testDef: WorkflowDefinition = {
      initial_step: "lint",
      steps: {
        lint: {
          goal: "Lint",
          transitions: [{ terminal: "success", when: "done" }],
        },
      },
    };

    // Config order: default, deploy, test
    fetchWorkflowsMock.mockResolvedValue({
      default: WORKFLOW_DEF,
      deploy: deployDef,
      test: testDef,
    });

    // Runs arrive in reverse order: test first, then deploy, then default
    fetchWorkflowRunsMock.mockResolvedValue([
      makeRun({
        id: "r1",
        workflow_name: "test",
        current_step: "lint",
        worktree_branch: "test-branch",
      }),
      makeRun({
        id: "r2",
        workflow_name: "deploy",
        current_step: "build",
        worktree_branch: "deploy-branch",
      }),
      makeRun({
        id: "r3",
        workflow_name: "default",
        current_step: "plan",
        worktree_branch: "default-branch",
      }),
    ]);

    render(
      <WorkflowKanbanBoard
        repositoryPath="/repos/org/name"
        activeWorktreeBranches={null}
      />,
    );

    await screen.findByText("default-branch");

    // Workflow headings should appear in config order: default, deploy, test
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual([
      "default",
      "deploy",
      "test",
    ]);
  });

  describe("multi-repo mode (no repositoryPath)", () => {
    it("fetches all workflow runs when repositoryPath is not provided", async () => {
      fetchAllWorkflowRunsMock.mockResolvedValue([
        makeRun({ id: "r1", current_step: "plan" }),
      ]);

      render(<WorkflowKanbanBoard activeWorktreeBranches={null} />);

      await screen.findByText("feature-branch");
      expect(fetchAllWorkflowRunsMock).toHaveBeenCalledWith();
      expect(fetchWorkflowRunsMock).not.toHaveBeenCalled();
    });

    it("displays runs from multiple repositories", async () => {
      fetchAllWorkflowRunsMock.mockResolvedValue([
        makeRun({
          id: "r1",
          repository_path: "/repos/org/alpha",
          worktree_branch: "alpha-feat",
          current_step: "plan",
        }),
        makeRun({
          id: "r2",
          repository_path: "/repos/org/beta",
          worktree_branch: "beta-feat",
          current_step: "implement",
        }),
      ]);

      render(<WorkflowKanbanBoard activeWorktreeBranches={null} />);

      await screen.findByText("alpha-feat");
      expect(screen.getByText("beta-feat")).toBeInTheDocument();
    });

    it("shows repository alias on cards in multi-repo mode", async () => {
      fetchAllWorkflowRunsMock.mockResolvedValue([
        makeRun({
          id: "r1",
          repository_path: "/repos/org/alpha",
          worktree_branch: "alpha-feat",
          current_step: "plan",
        }),
      ]);

      render(<WorkflowKanbanBoard activeWorktreeBranches={null} />);

      await screen.findByText("alpha-feat");
      expect(screen.getByText("org/alpha")).toBeInTheDocument();
    });

    it("does not show repository alias on cards in single-repo mode", async () => {
      fetchWorkflowRunsMock.mockResolvedValue([
        makeRun({
          id: "r1",
          repository_path: "/repos/org/alpha",
          worktree_branch: "alpha-feat",
          current_step: "plan",
        }),
      ]);

      render(
        <WorkflowKanbanBoard
          repositoryPath="/repos/org/alpha"
          activeWorktreeBranches={null}
        />,
      );

      await screen.findByText("alpha-feat");
      expect(screen.queryByText("org/alpha")).not.toBeInTheDocument();
    });
  });
});
