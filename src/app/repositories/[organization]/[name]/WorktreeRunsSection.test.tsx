// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRun, Worktree } from "@/lib/utils/api";
import { SWRTestProvider } from "@/test-swr-provider";

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

const { createWorktreeMock, cleanMergedWorktreesMock } = vi.hoisted(() => ({
  createWorktreeMock: vi.fn(),
  cleanMergedWorktreesMock: vi.fn(),
}));

vi.mock("@/lib/utils/api", async () => {
  const actual = await vi.importActual("@/lib/utils/api");
  return {
    ...actual,
    createWorktree: createWorktreeMock,
    cleanMergedWorktrees: cleanMergedWorktreesMock,
  };
});

import WorktreeRunsSection from "./WorktreeRunsSection";

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorktreeRunsSection", () => {
  it("keeps rendered runs visible when loading is true after first load", async () => {
    const worktrees = [makeWorktree({ branch: "feature-a", is_main: false })];
    const runs = [
      makeRun({
        id: "r1",
        worktree_branch: "feature-a",
        workflow_name: "develop",
      }),
    ];

    const { rerender } = render(
      <SWRTestProvider>
        <WorktreeRunsSection
          organization="org"
          name="name"
          worktrees={worktrees}
          runs={runs}
          loading={false}
          hasLoadedOnce={true}
          error={null}
        />
      </SWRTestProvider>,
    );

    await screen.findByText("develop");

    rerender(
      <SWRTestProvider>
        <WorktreeRunsSection
          organization="org"
          name="name"
          worktrees={worktrees}
          runs={runs}
          loading={true}
          hasLoadedOnce={true}
          error={null}
        />
      </SWRTestProvider>,
    );

    expect(screen.getByText("develop")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("renders worktrees with their workflow runs grouped underneath", async () => {
    const worktrees = [
      makeWorktree({ branch: "main", is_main: true }),
      makeWorktree({ branch: "feature-a", is_main: false }),
    ];
    const runs = [
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
    ];

    render(
      <SWRTestProvider>
        <WorktreeRunsSection
          organization="org"
          name="name"
          worktrees={worktrees}
          runs={runs}
          loading={false}
          hasLoadedOnce={true}
          error={null}
        />
      </SWRTestProvider>,
    );

    // Wait for data to load
    await screen.findByText("feature-a");

    // Main worktree is hidden; only non-main worktrees are shown
    expect(screen.queryByText("main")).not.toBeInTheDocument();
    expect(screen.getByText("feature-a")).toBeInTheDocument();

    // Runs should be visible under feature-a
    expect(screen.getByText("develop")).toBeInTheDocument();
    expect(screen.getByText("maintain-pr")).toBeInTheDocument();
  });

  it("shows worktrees with no runs", async () => {
    const worktrees = [
      makeWorktree({ branch: "main", is_main: true }),
      makeWorktree({ branch: "empty-branch", is_main: false }),
    ];

    render(
      <SWRTestProvider>
        <WorktreeRunsSection
          organization="org"
          name="name"
          worktrees={worktrees}
          runs={[]}
          loading={false}
          hasLoadedOnce={true}
          error={null}
        />
      </SWRTestProvider>,
    );

    await screen.findByText("empty-branch");
    expect(screen.queryByText("main")).not.toBeInTheDocument();
  });

  it("shows orphaned runs in a separate group", async () => {
    const worktrees = [makeWorktree({ branch: "main", is_main: true })];
    const runs = [makeRun({ id: "r1", worktree_branch: "deleted-branch" })];

    render(
      <SWRTestProvider>
        <WorktreeRunsSection
          organization="org"
          name="name"
          worktrees={worktrees}
          runs={runs}
          loading={false}
          hasLoadedOnce={true}
          error={null}
        />
      </SWRTestProvider>,
    );

    // Main is hidden; wait for orphaned group to appear
    await screen.findByText("Archived");
    expect(screen.getByText("deleted-branch")).toBeInTheDocument();
    expect(screen.queryByText("main")).not.toBeInTheDocument();
  });

  it("always shows runs without any expand/collapse toggle", async () => {
    const worktrees = [makeWorktree({ branch: "feature-a", is_main: false })];
    const runs = [
      makeRun({
        id: "r1",
        worktree_branch: "feature-a",
        status: "running",
        workflow_name: "develop",
      }),
    ];

    render(
      <SWRTestProvider>
        <WorktreeRunsSection
          organization="org"
          name="name"
          worktrees={worktrees}
          runs={runs}
          loading={false}
          hasLoadedOnce={true}
          error={null}
        />
      </SWRTestProvider>,
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
    const worktrees = [makeWorktree({ branch: "feature-a", is_main: false })];
    const runs = [
      makeRun({
        id: "r1",
        worktree_branch: "feature-a",
        workflow_name: "develop",
      }),
    ];

    render(
      <SWRTestProvider>
        <WorktreeRunsSection
          organization="org"
          name="name"
          worktrees={worktrees}
          runs={runs}
          loading={false}
          hasLoadedOnce={true}
          error={null}
        />
      </SWRTestProvider>,
    );

    await screen.findByText("feature-a");

    const worktreeLink = screen.getByRole("link", { name: /feature-a/ });
    expect(worktreeLink).toHaveAttribute(
      "href",
      "/repositories/org/name/worktrees/feature-a",
    );
  });

  it("renders the Archived group as plain text, not a link", async () => {
    const worktrees = [makeWorktree({ branch: "main", is_main: true })];
    const runs = [makeRun({ id: "r1", worktree_branch: "deleted-branch" })];

    render(
      <SWRTestProvider>
        <WorktreeRunsSection
          organization="org"
          name="name"
          worktrees={worktrees}
          runs={runs}
          loading={false}
          hasLoadedOnce={true}
          error={null}
        />
      </SWRTestProvider>,
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
    const worktrees = [makeWorktree({ branch: "feature-a", is_main: false })];
    const runs = [
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
    ];

    render(
      <SWRTestProvider>
        <WorktreeRunsSection
          organization="org"
          name="name"
          worktrees={worktrees}
          runs={runs}
          loading={false}
          hasLoadedOnce={true}
          error={null}
        />
      </SWRTestProvider>,
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
    const worktrees = [makeWorktree({ branch: "feature-a", is_main: false })];
    const runs = [
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
    ];

    render(
      <SWRTestProvider>
        <WorktreeRunsSection
          organization="org"
          name="name"
          worktrees={worktrees}
          runs={runs}
          loading={false}
          hasLoadedOnce={true}
          error={null}
        />
      </SWRTestProvider>,
    );

    await screen.findByText("feature-a");
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("shows relative time for each workflow run", async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const worktrees = [makeWorktree({ branch: "feature-a", is_main: false })];
    const runs = [
      makeRun({
        id: "r1",
        worktree_branch: "feature-a",
        created_at: oneHourAgo,
      }),
    ];

    render(
      <SWRTestProvider>
        <WorktreeRunsSection
          organization="org"
          name="name"
          worktrees={worktrees}
          runs={runs}
          loading={false}
          hasLoadedOnce={true}
          error={null}
        />
      </SWRTestProvider>,
    );

    await screen.findByText("feature-a");
    expect(screen.getByText("1h ago")).toBeInTheDocument();
  });

  it("links workflow runs to their detail pages", async () => {
    const worktrees = [makeWorktree({ branch: "feature-a", is_main: false })];
    const runs = [
      makeRun({
        id: "r1",
        worktree_branch: "feature-a",
        workflow_name: "develop",
      }),
    ];

    render(
      <SWRTestProvider>
        <WorktreeRunsSection
          organization="org"
          name="name"
          worktrees={worktrees}
          runs={runs}
          loading={false}
          hasLoadedOnce={true}
          error={null}
        />
      </SWRTestProvider>,
    );

    await screen.findByText("feature-a");

    const runLink = screen.getByRole("link", { name: /develop/ });
    expect(runLink).toHaveAttribute(
      "href",
      "/repositories/org/name/workflow-runs/r1",
    );
  });

  it("shows the current step for running workflow runs", async () => {
    const worktrees = [makeWorktree({ branch: "feature-a", is_main: false })];
    const runs = [
      makeRun({
        id: "r1",
        worktree_branch: "feature-a",
        workflow_name: "develop",
        current_step: "impelment",
        status: "running",
      }),
    ];

    render(
      <SWRTestProvider>
        <WorktreeRunsSection
          organization="org"
          name="name"
          worktrees={worktrees}
          runs={runs}
          loading={false}
          hasLoadedOnce={true}
          error={null}
        />
      </SWRTestProvider>,
    );

    const runLink = await screen.findByRole("link", { name: /develop/i });
    expect(within(runLink).getByText("develop")).toBeInTheDocument();
    expect(within(runLink).getByText("impelment")).toBeInTheDocument();
    expect(runLink).toHaveAttribute(
      "href",
      "/repositories/org/name/workflow-runs/r1",
    );
  });

  it("does not show the current step for non-running workflow runs", async () => {
    const worktrees = [makeWorktree({ branch: "feature-a", is_main: false })];
    const runs = [
      makeRun({
        id: "r1",
        worktree_branch: "feature-a",
        workflow_name: "develop",
        current_step: "impelment",
        status: "success",
      }),
    ];

    render(
      <SWRTestProvider>
        <WorktreeRunsSection
          organization="org"
          name="name"
          worktrees={worktrees}
          runs={runs}
          loading={false}
          hasLoadedOnce={true}
          error={null}
        />
      </SWRTestProvider>,
    );

    const runLink = await screen.findByRole("link", { name: /develop/i });
    expect(within(runLink).getByText("develop")).toBeInTheDocument();
    expect(within(runLink).queryByText("impelment")).not.toBeInTheDocument();
  });
});
