// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRun, Worktree } from "@/lib/utils/api";

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

vi.mock("next/navigation", () => ({
  usePathname: () => "/repositories/org/name",
}));

const {
  fetchWorktreesMock,
  fetchWorkflowRunsMock,
  createWorktreeMock,
  cleanMergedWorktreesMock,
} = vi.hoisted(() => ({
  fetchWorktreesMock: vi.fn(),
  fetchWorkflowRunsMock: vi.fn(),
  createWorktreeMock: vi.fn(),
  cleanMergedWorktreesMock: vi.fn(),
}));

vi.mock("@/lib/utils/api", async () => {
  const actual = await vi.importActual("@/lib/utils/api");
  return {
    ...actual,
    fetchWorktrees: fetchWorktreesMock,
    fetchWorkflowRuns: fetchWorkflowRunsMock,
    createWorktree: createWorktreeMock,
    cleanMergedWorktrees: cleanMergedWorktreesMock,
  };
});

import WorktreeRunsSection from "./WorktreeRunsSection";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeWorktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    branch: "main",
    path: "/repo/main",
    is_main: true,
    is_bare: false,
    head: "abc123",
    ...overrides,
  };
}

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run-1",
    repository_path: "/repos/org/name",
    worktree_branch: "feature-a",
    workflow_name: "develop",
    current_step: "code",
    status: "running",
    inputs: null,
    metadata: null,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  fetchWorktreesMock.mockResolvedValue([]);
  fetchWorkflowRunsMock.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorktreeRunsSection", () => {
  it("keeps rendered runs visible during refreshes after the first load", async () => {
    const nextWorktrees = deferred<Worktree[]>();
    const nextRuns = deferred<WorkflowRun[]>();

    fetchWorktreesMock
      .mockResolvedValueOnce([
        makeWorktree({ branch: "feature-a", is_main: false }),
      ])
      .mockReturnValueOnce(nextWorktrees.promise);
    fetchWorkflowRunsMock
      .mockResolvedValueOnce([
        makeRun({
          id: "r1",
          worktree_branch: "feature-a",
          workflow_name: "develop",
        }),
      ])
      .mockReturnValueOnce(nextRuns.promise);

    const { rerender } = render(
      <WorktreeRunsSection
        organization="org"
        name="name"
        repositoryPath="/repos/org/name"
        refreshKey={0}
      />,
    );

    await screen.findByText("develop");

    rerender(
      <WorktreeRunsSection
        organization="org"
        name="name"
        repositoryPath="/repos/org/name"
        refreshKey={1}
      />,
    );

    expect(screen.getByText("develop")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();

    nextWorktrees.resolve([
      makeWorktree({ branch: "feature-a", is_main: false }),
    ]);
    nextRuns.resolve([
      makeRun({
        id: "r1",
        worktree_branch: "feature-a",
        workflow_name: "develop",
      }),
    ]);
  });

  it("renders worktrees with their workflow runs grouped underneath", async () => {
    fetchWorktreesMock.mockResolvedValue([
      makeWorktree({ branch: "main", is_main: true }),
      makeWorktree({ branch: "feature-a", is_main: false }),
    ]);
    fetchWorkflowRunsMock.mockResolvedValue([
      makeRun({
        id: "r1",
        worktree_branch: "feature-a",
        workflow_name: "develop",
      }),
      makeRun({
        id: "r2",
        worktree_branch: "feature-a",
        workflow_name: "maintain-pr",
        status: "success",
      }),
    ]);

    render(
      <WorktreeRunsSection
        organization="org"
        name="name"
        repositoryPath="/repos/org/name"
      />,
    );

    // Wait for data to load
    await screen.findByText("feature-a");

    // Both worktrees should be visible
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("feature-a")).toBeInTheDocument();

    // Runs should be visible under feature-a
    expect(screen.getByText("develop")).toBeInTheDocument();
    expect(screen.getByText("maintain-pr")).toBeInTheDocument();
  });

  it("shows worktrees with no runs", async () => {
    fetchWorktreesMock.mockResolvedValue([
      makeWorktree({ branch: "main", is_main: true }),
      makeWorktree({ branch: "empty-branch", is_main: false }),
    ]);
    fetchWorkflowRunsMock.mockResolvedValue([]);

    render(
      <WorktreeRunsSection
        organization="org"
        name="name"
        repositoryPath="/repos/org/name"
      />,
    );

    await screen.findByText("main");
    expect(screen.getByText("empty-branch")).toBeInTheDocument();
  });

  it("shows orphaned runs in a separate group", async () => {
    fetchWorktreesMock.mockResolvedValue([
      makeWorktree({ branch: "main", is_main: true }),
    ]);
    fetchWorkflowRunsMock.mockResolvedValue([
      makeRun({ id: "r1", worktree_branch: "deleted-branch" }),
    ]);

    render(
      <WorktreeRunsSection
        organization="org"
        name="name"
        repositoryPath="/repos/org/name"
      />,
    );

    await screen.findByText("main");
    // The orphaned group should have a label
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.getByText("deleted-branch")).toBeInTheDocument();
  });

  it("always shows runs without any expand/collapse toggle", async () => {
    fetchWorktreesMock.mockResolvedValue([
      makeWorktree({ branch: "feature-a", is_main: false }),
    ]);
    fetchWorkflowRunsMock.mockResolvedValue([
      makeRun({
        id: "r1",
        worktree_branch: "feature-a",
        status: "running",
        workflow_name: "develop",
      }),
    ]);

    render(
      <WorktreeRunsSection
        organization="org"
        name="name"
        repositoryPath="/repos/org/name"
      />,
    );

    await screen.findByText("feature-a");

    // Runs should always be visible
    expect(screen.getByText("develop")).toBeVisible();

    // No expand/collapse toggle button for the worktree group
    expect(
      screen.queryByRole("button", { name: /feature-a/ }),
    ).not.toBeInTheDocument();
  });

  it("renders worktree names as links to the worktree detail page", async () => {
    fetchWorktreesMock.mockResolvedValue([
      makeWorktree({ branch: "feature-a", is_main: false }),
    ]);
    fetchWorkflowRunsMock.mockResolvedValue([
      makeRun({
        id: "r1",
        worktree_branch: "feature-a",
        workflow_name: "develop",
      }),
    ]);

    render(
      <WorktreeRunsSection
        organization="org"
        name="name"
        repositoryPath="/repos/org/name"
      />,
    );

    await screen.findByText("feature-a");

    const worktreeLink = screen.getByRole("link", { name: /feature-a/ });
    expect(worktreeLink).toHaveAttribute(
      "href",
      "/repositories/org/name/worktrees/feature-a",
    );
  });

  it("renders the Archived group as plain text, not a link", async () => {
    fetchWorktreesMock.mockResolvedValue([
      makeWorktree({ branch: "main", is_main: true }),
    ]);
    fetchWorkflowRunsMock.mockResolvedValue([
      makeRun({ id: "r1", worktree_branch: "deleted-branch" }),
    ]);

    render(
      <WorktreeRunsSection
        organization="org"
        name="name"
        repositoryPath="/repos/org/name"
      />,
    );

    await screen.findByText("Archived");

    // "Archived" should not be a link
    expect(
      screen.queryByRole("link", { name: /Archived/ }),
    ).not.toBeInTheDocument();
    // But it should still be visible as text
    expect(screen.getByText("Archived")).toBeVisible();
  });

  it("shows only 3 runs initially with a 'Show all' button for more", async () => {
    fetchWorktreesMock.mockResolvedValue([
      makeWorktree({ branch: "feature-a", is_main: false }),
    ]);
    fetchWorkflowRunsMock.mockResolvedValue([
      makeRun({
        id: "r1",
        worktree_branch: "feature-a",
        workflow_name: "run-1",
      }),
      makeRun({
        id: "r2",
        worktree_branch: "feature-a",
        workflow_name: "run-2",
      }),
      makeRun({
        id: "r3",
        worktree_branch: "feature-a",
        workflow_name: "run-3",
      }),
      makeRun({
        id: "r4",
        worktree_branch: "feature-a",
        workflow_name: "run-4",
      }),
      makeRun({
        id: "r5",
        worktree_branch: "feature-a",
        workflow_name: "run-5",
      }),
    ]);

    render(
      <WorktreeRunsSection
        organization="org"
        name="name"
        repositoryPath="/repos/org/name"
      />,
    );

    await screen.findByText("feature-a");

    // Only first 3 visible
    expect(screen.getByText("run-1")).toBeVisible();
    expect(screen.getByText("run-2")).toBeVisible();
    expect(screen.getByText("run-3")).toBeVisible();
    expect(screen.queryByText("run-4")).toBeNull();
    expect(screen.queryByText("run-5")).toBeNull();

    // Show all button present
    const showAllBtn = screen.getByRole("button", { name: /Show all/ });
    expect(showAllBtn).toBeVisible();

    // Click to expand
    await userEvent.click(showAllBtn);
    expect(screen.getByText("run-4")).toBeVisible();
    expect(screen.getByText("run-5")).toBeVisible();
  });

  it("does not show 'Show all' button when runs are 3 or fewer", async () => {
    fetchWorktreesMock.mockResolvedValue([
      makeWorktree({ branch: "feature-a", is_main: false }),
    ]);
    fetchWorkflowRunsMock.mockResolvedValue([
      makeRun({
        id: "r1",
        worktree_branch: "feature-a",
        workflow_name: "run-1",
      }),
      makeRun({
        id: "r2",
        worktree_branch: "feature-a",
        workflow_name: "run-2",
      }),
    ]);

    render(
      <WorktreeRunsSection
        organization="org"
        name="name"
        repositoryPath="/repos/org/name"
      />,
    );

    await screen.findByText("feature-a");
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("shows relative time for each workflow run", async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    fetchWorktreesMock.mockResolvedValue([
      makeWorktree({ branch: "feature-a", is_main: false }),
    ]);
    fetchWorkflowRunsMock.mockResolvedValue([
      makeRun({
        id: "r1",
        worktree_branch: "feature-a",
        created_at: oneHourAgo,
      }),
    ]);

    render(
      <WorktreeRunsSection
        organization="org"
        name="name"
        repositoryPath="/repos/org/name"
      />,
    );

    await screen.findByText("feature-a");
    expect(screen.getByText("1h ago")).toBeInTheDocument();
  });

  it("links workflow runs to their detail pages", async () => {
    fetchWorktreesMock.mockResolvedValue([
      makeWorktree({ branch: "feature-a", is_main: false }),
    ]);
    fetchWorkflowRunsMock.mockResolvedValue([
      makeRun({
        id: "r1",
        worktree_branch: "feature-a",
        workflow_name: "develop",
      }),
    ]);

    render(
      <WorktreeRunsSection
        organization="org"
        name="name"
        repositoryPath="/repos/org/name"
      />,
    );

    await screen.findByText("feature-a");

    const runLink = screen.getByRole("link", { name: /develop/ });
    expect(runLink).toHaveAttribute(
      "href",
      "/repositories/org/name/workflow-runs/r1",
    );
  });
});
